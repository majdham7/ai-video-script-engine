import { NextRequest } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import dns from "dns";
import { Agent, setGlobalDispatcher } from "undici";
import jwt from "jsonwebtoken";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";

// Force IPv4 for all fetch calls — fixes ENOTFOUND on macOS where Node prefers IPv6.
dns.setDefaultResultOrder("ipv4first");
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

// @ffmpeg-installer/ffmpeg bundles a platform-correct binary (macOS locally,
// Linux on Vercel) — avoids relying on a Homebrew path that doesn't exist
// in Vercel's serverless environment.
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Vercel serverless functions default to a short timeout — extend it since
// video generation (multiple Kling calls + ffmpeg) takes several minutes.
export const maxDuration = 300;

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

function sseEvent(data: object): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------------------------------------------------------------------------
// Kling AI helpers
// Docs: https://docs.klingai.com/api-reference/video-generation
// ---------------------------------------------------------------------------

// Kling uses a single Bearer API key for auth.
function makeKlingToken(apiKey: string): string {
  return apiKey;
}

// 1. Submit a text-to-video task to Kling and return the task ID.
//    No seed image needed — Kling's text-to-video is strong enough to drive visuals.
async function submitKlingTask(
  apiKey: string,
  visualPrompt: string,
  cameraMovement: string,
  style: string
): Promise<string> {
  const token = makeKlingToken(apiKey);

  const res = await fetch("https://api.klingai.com/v1/videos/text2video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_name: "kling-v3",
      prompt: `${style} style. ${visualPrompt}. Camera movement: ${cameraMovement}. Cinematic quality, professional production.`,
      negative_prompt: "blurry, low quality, distorted, amateur",
      cfg_scale: 0.5,
      mode: "std",  // "std" (faster/cheaper) or "pro" (higher quality)
      duration: "10", // each scene becomes a 10s clip — matched to LENGTH_SCENE_COUNT below
    }),
  });

  const json = (await res.json()) as { code: number; message: string; data?: { task_id: string } };
  if (json.code !== 0 || !json.data?.task_id) {
    throw new Error(`Kling submit failed: ${json.message}`);
  }
  return json.data.task_id;
}

// 2. Poll Kling until the task succeeds, then return the video URL.
async function pollKlingTask(
  apiKey: string,
  taskId: string
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 8000));

    const token = makeKlingToken(apiKey);
    const res = await fetch(`https://api.klingai.com/v1/videos/text2video/${taskId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const json = (await res.json()) as {
      code: number;
      message: string;
      data?: {
        task_status: string;
        task_result?: { videos?: { url: string }[] };
      };
    };

    if (json.code !== 0) throw new Error(`Kling poll failed: ${json.message}`);

    const status = json.data?.task_status;
    if (status === "succeed") {
      const url = json.data?.task_result?.videos?.[0]?.url;
      if (!url) throw new Error("Kling succeeded but returned no video URL.");
      return url;
    }
    if (status === "failed") throw new Error(`Kling task ${taskId} failed.`);
    // status is "submitted" or "processing" — keep polling
  }
  throw new Error("Kling task timed out after 5 minutes.");
}

// ---------------------------------------------------------------------------
// ElevenLabs voiceover
// ---------------------------------------------------------------------------

async function generateVoiceover(
  eleven: ElevenLabsClient,
  text: string,
  outputPath: string
): Promise<string> {
  // "Rachel" — clear neutral English voice available on all plans.
  const audioStream = await eleven.textToSpeech.convert("21m00Tcm4TlvDq8ikWAM", {
    text,
    modelId: "eleven_multilingual_v2",
    voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
  });

  const buffer = await streamToBuffer(audioStream as unknown as Readable);
  await fsp.writeFile(outputPath, buffer);
  return outputPath;
}

// ---------------------------------------------------------------------------
// FFmpeg helpers
// ---------------------------------------------------------------------------

async function downloadFile(url: string, dest: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  await fsp.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function mergeVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<string> {
  // Pad the voiceover with silence so it never truncates the video — without
  // this, "-shortest" alone would cut the clip down to match a short
  // voiceover line, silently shrinking the total runtime.
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .complexFilter(["[1:a]apad[padded]"])
      .outputOptions(["-map 0:v:0", "-map [padded]", "-c:v copy", "-c:a aac", "-shortest"])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject)
      .run();
  });
}

async function concatenateClips(clipPaths: string[], outputPath: string): Promise<string> {
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
  const missingVars = ["KLING_API_KEY", "ELEVENLABS_API_KEY"]
    .filter((k) => !process.env[k]);

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

  const klingApiKey = process.env.KLING_API_KEY!;
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

          // --- Step A: Submit video task to Kling ---
          send({ type: "progress", scene: sceneNum, total, step: "video", message: `Scene ${sceneNum}/${total}: Submitting to Kling AI…` });
          const taskId = await submitKlingTask(klingApiKey, scene.visualPrompt, scene.cameraMovement, style);

          // --- Step B: Poll until Kling finishes (~1–2 min) ---
          send({ type: "progress", scene: sceneNum, total, step: "video", message: `Scene ${sceneNum}/${total}: Kling AI generating video… (~1–2 min)` });
          const clipUrl = await pollKlingTask(klingApiKey, taskId);
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

        // --- Final: Stitch all scenes ---
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
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
