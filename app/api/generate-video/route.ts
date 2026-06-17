import { NextRequest } from "next/server";
import RunwayML from "@runwayml/sdk";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import OpenAI from "openai";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";

// Point fluent-ffmpeg at the bundled static binary.
ffmpeg.setFfmpegPath(ffmpegStatic as string);

// Temporary directory for all intermediate and final files.
const TMP_DIR = path.join("/tmp", "engine-videos");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Scene {
  startTime: string;
  endTime: string;
  voiceoverText: string;
  visualPrompt: string;
  cameraMovement: string;
}

interface GenerateVideoBody {
  scenes: Scene[];
  style: string;
  videoTitle: string;
}

// SSE helper — encodes a JSON object as a server-sent event line.
function sseEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

// 1. DALL-E 3: generate a keyframe image URL from a visual prompt.
async function generateKeyframe(
  openai: OpenAI,
  visualPrompt: string,
  style: string
): Promise<string> {
  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt: `${style} style cinematic still frame: ${visualPrompt}`,
    n: 1,
    size: "1792x1024", // 16:9-ish
    quality: "standard",
  });

  const url = response.data?.[0]?.url;
  if (!url) throw new Error("DALL-E returned no image URL.");
  return url;
}

// 2. Runway Gen-3: animate the keyframe into a 5-second video clip.
//    The API is asynchronous — we create a task then poll until done.
async function generateClip(
  runway: RunwayML,
  imageUrl: string,
  visualPrompt: string,
  cameraMovement: string
): Promise<string> {
  const task = await runway.imageToVideo.create({
    model: "gen4_turbo",
    promptImage: imageUrl,
    promptText: `${visualPrompt}. Camera: ${cameraMovement}.`,
    duration: 5,
    ratio: "1280:720",
  });

  // Poll every 8 seconds until the clip is ready.
  let result = await runway.tasks.retrieve(task.id);
  while (result.status !== "SUCCEEDED" && result.status !== "FAILED") {
    await new Promise((r) => setTimeout(r, 8000));
    result = await runway.tasks.retrieve(task.id);
  }

  if (result.status === "FAILED" || !result.output?.[0]) {
    throw new Error(`Runway task ${task.id} failed.`);
  }

  return result.output[0]; // Public video URL
}

// 3. ElevenLabs: synthesise voiceover audio from text.
//    Returns the path to the saved MP3 file.
async function generateVoiceover(
  eleven: ElevenLabsClient,
  text: string,
  outputPath: string
): Promise<string> {
  // "Rachel" is a clear, neutral English voice available on all plans.
  const audioStream = await eleven.textToSpeech.convert("21m00Tcm4TlvDq8ikWAM", {
    text,
    modelId: "eleven_multilingual_v2",
    voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
  });

  await fsp.writeFile(outputPath, Buffer.from(await streamToBuffer(audioStream as unknown as Readable)));
  return outputPath;
}

// 4. Download a remote video/image URL and save it locally.
async function downloadFile(url: string, dest: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(dest, buffer);
  return dest;
}

// Utility: drain a Node Readable stream into a Buffer.
async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// 5. FFmpeg: merge a video clip with its voiceover audio.
async function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-c:v copy",      // keep original video codec
        "-c:a aac",       // encode audio to AAC
        "-shortest",      // trim to shortest stream (video or audio)
        "-map 0:v:0",     // take video from first input
        "-map 1:a:0",     // take audio from second input
      ])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .run();
  });
}

// 6. FFmpeg: concatenate all merged scene clips into one final video.
async function concatenateClips(
  clipPaths: string[],
  outputPath: string
): Promise<string> {
  // Write a concat demuxer list file.
  const listPath = path.join(TMP_DIR, "concat_list.txt");
  const listContent = clipPaths
    .map((p) => `file '${p}'`)
    .join("\n");
  await fsp.writeFile(listPath, listContent);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .run();
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  // Validate environment variables up front.
  const missingVars = [
    "OPENAI_API_KEY",
    "RUNWAYML_API_SECRET",
    "ELEVENLABS_API_KEY",
  ].filter((k) => !process.env[k]);

  if (missingVars.length) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: `Missing env vars: ${missingVars.join(", ")}` })}\n\n`,
      { status: 500, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  let body: GenerateVideoBody;
  try {
    body = (await req.json()) as GenerateVideoBody;
  } catch {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Invalid JSON body." })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  const { scenes, style, videoTitle } = body;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "scenes array is required." })}\n\n`,
      { status: 400, headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // Initialise SDK clients.
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const runway = new RunwayML({ apiKey: process.env.RUNWAYML_API_SECRET });
  const eleven = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

  // Unique working directory for this job.
  const jobId = Date.now().toString();
  const jobDir = path.join(TMP_DIR, jobId);
  await fsp.mkdir(jobDir, { recursive: true });

  // The final output filename — accessible via /api/video/[jobId]/final.mp4
  const finalOutputPath = path.join(jobDir, "final.mp4");

  // Stream SSE progress events back to the client.
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseEvent(data));

      try {
        const mergedClips: string[] = [];

        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          const sceneNum = i + 1;
          const total = scenes.length;

          // --- Step A: Generate keyframe image ---
          send({ type: "progress", scene: sceneNum, total, step: "image", message: `Scene ${sceneNum}/${total}: Generating keyframe with DALL-E…` });
          const imageUrl = await generateKeyframe(openai, scene.visualPrompt, style);

          // Download the image locally so Runway can fetch it if needed.
          const imagePath = path.join(jobDir, `scene${sceneNum}_frame.png`);
          await downloadFile(imageUrl, imagePath);

          // --- Step B: Animate with Runway ---
          send({ type: "progress", scene: sceneNum, total, step: "video", message: `Scene ${sceneNum}/${total}: Animating with Runway Gen-4… (this takes ~1 min)` });
          const clipUrl = await generateClip(runway, imageUrl, scene.visualPrompt, scene.cameraMovement);

          const clipPath = path.join(jobDir, `scene${sceneNum}_clip.mp4`);
          await downloadFile(clipUrl, clipPath);

          // --- Step C: Voiceover with ElevenLabs ---
          send({ type: "progress", scene: sceneNum, total, step: "audio", message: `Scene ${sceneNum}/${total}: Recording voiceover with ElevenLabs…` });
          const audioPath = path.join(jobDir, `scene${sceneNum}_audio.mp3`);
          await generateVoiceover(eleven, scene.voiceoverText, audioPath);

          // --- Step D: Merge video + audio ---
          send({ type: "progress", scene: sceneNum, total, step: "merge", message: `Scene ${sceneNum}/${total}: Merging video and audio…` });
          const mergedPath = path.join(jobDir, `scene${sceneNum}_merged.mp4`);
          await mergeVideoAudio(clipPath, audioPath, mergedPath);

          mergedClips.push(mergedPath);
        }

        // --- Final step: Concatenate all scenes ---
        send({ type: "progress", scene: scenes.length, total: scenes.length, step: "concat", message: "Stitching all scenes into final video…" });
        await concatenateClips(mergedClips, finalOutputPath);

        // Confirm the file exists before telling the client.
        await fsp.access(finalOutputPath, fs.constants.F_OK);

        send({
          type: "done",
          videoUrl: `/api/video/${jobId}/final.mp4`,
          videoTitle,
        });
      } catch (err) {
        console.error("generate-video error:", err);
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Video generation failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
