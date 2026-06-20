import { NextRequest } from "next/server";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import ffmpeg from "fluent-ffmpeg";
import { execSync } from "child_process";
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

// Use Homebrew ffmpeg — Next.js bundler mangles ffmpeg-static paths.
const FFMPEG_PATH = (() => {
  try { return execSync("which ffmpeg").toString().trim(); }
  catch { return "/opt/homebrew/bin/ffmpeg"; }
})();
ffmpeg.setFfmpegPath(FFMPEG_PATH);

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

// Kling uses short-lived JWT tokens for auth — regenerated per request.
function makeKlingToken(accessKeyId: string, accessKeySecret: string): string {
  return jwt.sign(
    { iss: accessKeyId, exp: Math.floor(Date.now() / 1000) + 1800, nbf: Math.floor(Date.now() / 1000) - 5 },
    accessKeySecret,
    { algorithm: "HS256", header: { alg: "HS256", typ: "JWT" } }
  );
}

// 1. Submit a text-to-video task to Kling and return the task ID.
//    No seed image needed — Kling's text-to-video is strong enough to drive visuals.
async function submitKlingTask(
  accessKeyId: string,
  accessKeySecret: string,
  visualPrompt: string,
  cameraMovement: string,
  style: string
): Promise<string> {
  const token = makeKlingToken(accessKeyId, accessKeySecret);

  const res = await fetch("https://api.klingai.com/v1/videos/text2video", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model_name: "kling-v1",
      prompt: `${style} style. ${visualPrompt}. Camera movement: ${cameraMovement}. Cinematic quality, professional production.`,
      negative_prompt: "blurry, low quality, distorted, amateur",
      cfg_scale: 0.5,
      mode: "std",  // "std" (faster/cheaper) or "pro" (higher quality)
      duration: "5",
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
  accessKeyId: string,
  accessKeySecret: string,
  taskId: string
): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((r) => setTimeout(r, 8000));

    const token = makeKlingToken(accessKeyId, accessKeySecret);
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
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions(["-c:v copy", "-c:a aac", "-shortest", "-map 0:v:0", "-map 1:a:0"])
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
  const missingVars = ["KLING_ACCESS_KEY_ID", "KLING_ACCESS_KEY_SECRET", "ELEVENLABS_API_KEY"]
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

  const klingId = process.env.KLING_ACCESS_KEY_ID!;
  const klingSecret = process.env.KLING_ACCESS_KEY_SECRET!;
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
          const taskId = await submitKlingTask(klingId, klingSecret, scene.visualPrompt, scene.cameraMovement, style);

          // --- Step B: Poll until Kling finishes (~1–2 min) ---
          send({ type: "progress", scene: sceneNum, total, step: "video", message: `Scene ${sceneNum}/${total}: Kling AI generating video… (~1–2 min)` });
          const clipUrl = await pollKlingTask(klingId, klingSecret, taskId);
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
