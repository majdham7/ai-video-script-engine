import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPUS_CLIP_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPUS_CLIP_API_KEY not set." }, { status: 500 });

  try {
    const json = await req.json() as { videoUrl?: string; duration?: string; model?: string; prompt?: string };
    const videoUrl = json.videoUrl;
    const duration = json.duration ?? "30-90";
    const model = json.model ?? "ClipAnything";
    const customPrompt = json.prompt ?? "";

    if (!videoUrl) return NextResponse.json({ error: "No video URL provided." }, { status: 400 });

    const [minDur, maxDur] = duration.split("-").map(Number);

    const body: Record<string, unknown> = {
      url: videoUrl,
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
