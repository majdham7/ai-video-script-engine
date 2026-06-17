import { NextRequest } from "next/server";
import RunwayML from "@runwayml/sdk";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import ffmpeg from "fluent-ffmpeg";
import sharp from "sharp";
import { execSync } from "child_process";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";

// Use the system ffmpeg (Homebrew) — avoids Next.js bundler mangling ffmpeg-static paths.
const FFMPEG_PATH = (() => {
  try {
    return execSync("which ffmpeg").toString().trim();
  } catch {
    return "/opt/homebrew/bin/ffmpeg"; // Homebrew default on Apple Silicon
  }
})();
ffmpeg.setFfmpegPath(FFMPEG_PATH);

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

// 1. Create a simple dark seed image using sharp (no external API needed).
//    Runway uses this as a starting frame but the text prompt drives the visuals.
async function createSeedImage(outputPath: string): Promise<string> {
  // Create a dark-to-slightly-lighter gradient so Runway has texture to work with.
  const width = 1280;
  const height = 720;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      pixels[i] = Math.floor(10 + (x / width) * 20);     // R
      pixels[i + 1] = Math.floor(10 + (y / height) * 15); // G
      pixels[i + 2] = Math.floor(20 + (x / width) * 30); // B
    }
  }
  await sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toFile(outputPath);

  return outputPath;
}

// 2. Runway Gen-4 Turbo: animate the seed image into a 5-second video clip.
//    The API is asynchronous — we create a task then poll until done.
async function generateClip(
  runway: RunwayML,
  imagePath: string,
  visualPrompt: string,
  cameraMovement: string,
  style: string
): Promise<string> {
  // Runway accepts base64 data URLs directly.
  const imageBuffer = await fsp.readFile(imagePath);
  const imageDataUrl = `data:image/png;base64,${imageBuffer.toString("base64")}`;

  const task = await runway.imageToVideo.create({
    model: "gen4_turbo",
    promptImage: imageDataUrl,
    promptText: `${style} style. ${visualPrompt}. Camera: ${cameraMovement}.`,
    duration: 5,
    ratio: "1280:720",
  });

  // Poll every 8 seconds until the clip is ready (typically 45–90s).
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
  // "Rachel" — clear, neutral English voice available on all plans.
  const audioStream = await eleven.textToSpeech.convert("21m00Tcm4TlvDq8ikWAM", {
    text,
    modelId: "eleven_multilingual_v2",
    voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
  });

  const buffer = await streamToBuffer(audioStream as unknown as Readable);
  await fsp.writeFile(outputPath, buffer);
  return outputPath;
}

// 4. Download a remote video URL and save it locally.
async function downloadFile(url: string, dest: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
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
        "-c:v copy",   // keep original video codec
        "-c:a aac",    // encode audio to AAC
        "-shortest",   // trim to shortest stream
        "-map 0:v:0",
        "-map 1:a:0",
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
  const listPath = path.join(TMP_DIR, "concat_list.txt");
  await fsp.writeFile(listPath, clipPaths.map((p) => `file '${p}'`).join("\n"));

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
  const missingVars = ["RUNWAYML_API_SECRET", "ELEVENLABS_API_KEY"].filter(
    (k) => !process.env[k]
  );

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

  const runway = new RunwayML({ apiKey: process.env.RUNWAYML_API_SECRET });
  const eleven = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

  const jobId = Date.now().toString();
  const jobDir = path.join(TMP_DIR, jobId);
  await fsp.mkdir(jobDir, { recursive: true });
  const finalOutputPath = path.join(jobDir, "final.mp4");

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseEvent(data));

      try {
        const mergedClips: string[] = [];

        for (let i = 0; i < scenes.length; i++) {
          const scene = scenes[i];
          const sceneNum = i + 1;
          const total = scenes.length;

          // --- Step A: Create seed image with sharp ---
          send({ type: "progress", scene: sceneNum, total, step: "image", message: `Scene ${sceneNum}/${total}: Preparing seed frame…` });
          const seedPath = path.join(jobDir, `scene${sceneNum}_seed.png`);
          await createSeedImage(seedPath);

          // --- Step B: Generate video clip with Runway ---
          send({ type: "progress", scene: sceneNum, total, step: "video", message: `Scene ${sceneNum}/${total}: Generating video with Runway Gen-4… (~1 min)` });
          const clipUrl = await generateClip(runway, seedPath, scene.visualPrompt, scene.cameraMovement, style);
          const clipPath = path.join(jobDir, `scene${sceneNum}_clip.mp4`);
          await downloadFile(clipUrl, clipPath);

          // --- Step C: Voiceover with ElevenLabs ---
          send({ type: "progress", scene: sceneNum, total, step: "audio", message: `Scene ${sceneNum}/${total}: Recording voiceover…` });
          const audioPath = path.join(jobDir, `scene${sceneNum}_audio.mp3`);
          await generateVoiceover(eleven, scene.voiceoverText, audioPath);

          // --- Step D: Merge video + audio ---
          send({ type: "progress", scene: sceneNum, total, step: "merge", message: `Scene ${sceneNum}/${total}: Merging video and audio…` });
          const mergedPath = path.join(jobDir, `scene${sceneNum}_merged.mp4`);
          await mergeVideoAudio(clipPath, audioPath, mergedPath);

          mergedClips.push(mergedPath);
        }

        // --- Final: Concatenate all scenes ---
        send({ type: "progress", scene: scenes.length, total: scenes.length, step: "concat", message: "Stitching all scenes into final video…" });
        await concatenateClips(mergedClips, finalOutputPath);
        await fsp.access(finalOutputPath, fs.constants.F_OK);

        send({ type: "done", videoUrl: `/api/video/${jobId}/final.mp4`, videoTitle });
      } catch (err) {
        console.error("generate-video error:", err);
        send({ type: "error", message: err instanceof Error ? err.message : "Video generation failed." });
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
