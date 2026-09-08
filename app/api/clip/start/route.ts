import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPUS_CLIP_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPUS_CLIP_API_KEY not set." }, { status: 500 });

  try {
    const formData = await req.formData();
    const file = formData.get("video") as File | null;
    const duration = (formData.get("duration") as string) ?? "30-90";
    const model = (formData.get("model") as string) ?? "ClipAnything";
    const customPrompt = (formData.get("prompt") as string) ?? "";

    if (!file) return NextResponse.json({ error: "No video file provided." }, { status: 400 });

    // Upload to Vercel Blob so Opus Clip can fetch it via public URL
    const blob = await put(`uploads/${Date.now()}-${file.name}`, file, {
      access: "public",
      contentType: file.type || "video/mp4",
    });

    const [minDur, maxDur] = duration.split("-").map(Number);

    const body: Record<string, unknown> = {
      url: blob.url,
      model,
      clipDurations: [[minDur, maxDur]],
      layoutAspectRatio: "portrait",
      quickstartConfig: { enableRemoveFillerWords: true },
    };

    if (model === "ClipAnything" && customPrompt) {
      body.customPrompt = customPrompt;
    }

    const res = await fetch("https://api.opus.pro/api/clip-projects", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { return NextResponse.json({ error: `Opus Clip error: ${text}` }, { status: 500 }); }

    const data = json as { id?: string; projectId?: string; errorMessage?: string };
    if (data.errorMessage) return NextResponse.json({ error: data.errorMessage }, { status: 500 });

    const projectId = data.id ?? data.projectId;
    if (!projectId) return NextResponse.json({ error: "No project ID returned.", raw: json }, { status: 500 });

    return NextResponse.json({ projectId, videoUrl: blob.url });
  } catch (err) {
    console.error("clip/start error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}
