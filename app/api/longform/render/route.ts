import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const maxDuration = 60;

const SHOTSTACK_URLS: Record<string, string> = {
  sandbox: "https://api.shotstack.io/stage/v1",
  production: "https://api.shotstack.io/v1",
};

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("video") as File | null;
    const outputLength = parseInt((formData.get("outputLength") as string) ?? "60", 10);
    const style = (formData.get("style") as string) ?? "highlights";
    const title = (formData.get("title") as string) ?? "";
    const env = (formData.get("env") as string) === "production" ? "production" : "sandbox";

    if (!file) return NextResponse.json({ error: "No video file provided." }, { status: 400 });

    const apiKey = env === "production"
      ? process.env.SHOTSTACK_PROD_KEY
      : process.env.SHOTSTACK_SANDBOX_KEY;

    if (!apiKey) return NextResponse.json({ error: `SHOTSTACK_${env.toUpperCase()}_KEY not configured.` }, { status: 500 });

    const baseUrl = SHOTSTACK_URLS[env];

    // Upload to Vercel Blob so Shotstack can fetch it
    const blob = await put(`longform/${Date.now()}-${file.name}`, file, {
      access: "public",
      contentType: file.type || "video/mp4",
    });

    const videoSrc = blob.url;
    const tracks: unknown[] = [];

    if (style === "highlights") {
      // Sample 3 equal segments spread across the video
      // We don't know total duration, so use outputLength as proxy — trim offsets are safe guesses
      const segLen = Math.floor(outputLength / 3);
      const gap = Math.floor(outputLength * 0.8); // approximate spacing between segments
      tracks.push({
        clips: [
          { asset: { type: "video", src: videoSrc, trim: 0 }, start: 0, length: segLen, transition: { in: "fade", out: "fade" } },
          { asset: { type: "video", src: videoSrc, trim: gap }, start: segLen, length: segLen, transition: { in: "fade", out: "fade" } },
          { asset: { type: "video", src: videoSrc, trim: gap * 2 }, start: segLen * 2, length: segLen, transition: { in: "fade", out: "fade" } },
        ],
      });
    } else {
      // Documentary / social: linear from beginning
      const clip: Record<string, unknown> = {
        asset: { type: "video", src: videoSrc, trim: 0 },
        start: 0,
        length: outputLength,
        transition: { in: "fade", out: "fade" },
      };
      if (style === "social") clip.effect = "zoomIn";
      tracks.push({ clips: [clip] });
    }

    // Title overlay
    if (title.trim()) {
      tracks.push({
        clips: [{
          asset: {
            type: "title",
            text: title.trim(),
            style: "minimal",
            color: "#ffffff",
            size: "medium",
            position: "bottom",
          },
          start: 0,
          length: Math.min(4, outputLength),
          transition: { in: "fade", out: "fade" },
        }],
      });
    }

    const edit = {
      timeline: { background: "#000000", tracks },
      output: { format: "mp4", resolution: "hd", fps: 30 },
    };

    const res = await fetch(`${baseUrl}/render`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(edit),
    });

    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch {
      return NextResponse.json({ error: `Shotstack returned invalid response: ${text.slice(0, 200)}` }, { status: 500 });
    }

    const data = json as { response?: { id?: string }; message?: string };
    if (!data.response?.id) {
      return NextResponse.json({ error: data.message ?? "No render ID returned.", raw: json }, { status: 500 });
    }

    return NextResponse.json({ renderId: data.response.id, env });
  } catch (err) {
    console.error("longform/render error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Render failed." }, { status: 500 });
  }
}
