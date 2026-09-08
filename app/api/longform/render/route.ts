import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const maxDuration = 60;

const SHOTSTACK = {
  sandbox: {
    url: "https://api.shotstack.io/stage/v1",
    key: process.env.SHOTSTACK_SANDBOX_KEY!,
  },
  production: {
    url: "https://api.shotstack.io/v1",
    key: process.env.SHOTSTACK_PROD_KEY!,
  },
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

    const { url: shotKey } = SHOTSTACK[env];
    const apiKey = SHOTSTACK[env].key;
    if (!apiKey) return NextResponse.json({ error: `SHOTSTACK_${env.toUpperCase()}_KEY not set.` }, { status: 500 });

    // Upload to Vercel Blob for a public URL Shotstack can fetch
    const blob = await put(`longform/${Date.now()}-${file.name}`, file, {
      access: "public",
      contentType: file.type || "video/mp4",
    });

    const tracks: unknown[] = [];

    // Main video clip track
    const mainClips: unknown[] = [];

    if (style === "highlights") {
      // Take first third, middle third, last third — rough highlight sampling
      const segLen = Math.round(outputLength / 3);
      mainClips.push(
        { asset: { type: "video", src: blob.url, trim: 0 }, start: 0, length: segLen, transition: { in: "fade", out: "fade" } },
        { asset: { type: "video", src: blob.url, trim: segLen * 2 }, start: segLen, length: segLen, transition: { in: "fade", out: "fade" } },
        { asset: { type: "video", src: blob.url, trim: segLen * 4 }, start: segLen * 2, length: segLen, transition: { in: "fade", out: "fade" } }
      );
    } else {
      // Documentary / social: use the first N seconds straight
      mainClips.push({
        asset: { type: "video", src: blob.url, trim: 0 },
        start: 0,
        length: outputLength,
        effect: style === "social" ? "zoomIn" : undefined,
        transition: { in: "fade", out: "fade" },
      });
    }

    tracks.push({ clips: mainClips });

    // Title overlay if provided
    if (title.trim()) {
      tracks.push({
        clips: [
          {
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
          },
        ],
      });
    }

    const edit = {
      timeline: {
        background: "#000000",
        tracks,
      },
      output: {
        format: "mp4",
        resolution: "hd",
        fps: 30,
      },
    };

    const res = await fetch(`${shotKey}/render`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(edit),
    });

    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { return NextResponse.json({ error: `Shotstack error: ${text}` }, { status: 500 }); }

    const data = json as { response?: { id?: string; status?: string }; message?: string };
    if (!res.ok || !data.response?.id) {
      return NextResponse.json({ error: data.message ?? "Shotstack render failed.", raw: json }, { status: 500 });
    }

    return NextResponse.json({ renderId: data.response.id, env, videoUrl: blob.url });
  } catch (err) {
    console.error("longform/render error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}
