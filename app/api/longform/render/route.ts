import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

const SHOTSTACK_URLS: Record<string, string> = {
  sandbox: "https://api.shotstack.io/edit/stage/v1",
  production: "https://api.shotstack.io/edit/v1",
};

export async function POST(req: NextRequest) {
  try {
    const json = await req.json() as { videoUrl?: string; outputLength?: string; style?: string; title?: string; env?: string };
    const videoSrc = json.videoUrl;
    const outputLength = parseInt(json.outputLength ?? "60", 10);
    const style = json.style ?? "highlights";
    const title = json.title ?? "";
    const env = json.env === "production" ? "production" : "sandbox";

    if (!videoSrc) return NextResponse.json({ error: "No video URL provided." }, { status: 400 });

    const apiKey = env === "production"
      ? process.env.SHOTSTACK_PROD_KEY
      : process.env.SHOTSTACK_SANDBOX_KEY;

    if (!apiKey) return NextResponse.json({ error: `SHOTSTACK_${env.toUpperCase()}_KEY not configured.` }, { status: 500 });

    const baseUrl = SHOTSTACK_URLS[env];
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
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch {
      return NextResponse.json({ error: `Shotstack returned invalid response: ${text.slice(0, 200)}` }, { status: 500 });
    }

    const data = parsed as { response?: { id?: string }; message?: string; error?: string };
    if (!data.response?.id) {
      const msg = data.message ?? data.error ?? JSON.stringify(parsed).slice(0, 200);
      return NextResponse.json({ error: `Shotstack: ${msg}` }, { status: 500 });
    }

    return NextResponse.json({ renderId: data.response.id, env });
  } catch (err) {
    console.error("longform/render error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Render failed." }, { status: 500 });
  }
}
