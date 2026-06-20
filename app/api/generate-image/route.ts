import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// Maps each social platform to the best gpt-image-1 size.
const PLATFORM_SIZE: Record<string, "1024x1024" | "1024x1536" | "1536x1024"> = {
  "Instagram Post":      "1024x1024",  // square
  "Instagram Story":     "1024x1536",  // 9:16 portrait
  "TikTok Cover":        "1024x1536",  // 9:16 portrait
  "Twitter / X":         "1536x1024",  // 16:9 landscape
  "LinkedIn":            "1536x1024",  // landscape
  "YouTube Thumbnail":   "1536x1024",  // 16:9 landscape
  "Facebook Post":       "1536x1024",  // landscape
};

const ALLOWED_PLATFORMS = Object.keys(PLATFORM_SIZE);

const ALLOWED_STYLES = [
  "Photorealistic",
  "Cinematic",
  "Illustration",
  "3D Render",
  "Minimalist",
  "Neon / Cyberpunk",
  "Vintage / Retro",
  "Bold & Graphic",
];

const ALLOWED_TONES = [
  "Professional",
  "Fun & Playful",
  "Luxury",
  "Bold & Energetic",
  "Calm & Serene",
  "Dark & Dramatic",
];

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY is not set." }, { status: 500 });
  }

  let body: {
    prompt?: unknown;
    platform?: unknown;
    style?: unknown;
    tone?: unknown;
    count?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { prompt, platform, style, tone, count = 1 } = body;

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ error: "`prompt` is required." }, { status: 400 });
  }
  if (typeof platform !== "string" || !ALLOWED_PLATFORMS.includes(platform)) {
    return NextResponse.json({ error: `\`platform\` must be one of: ${ALLOWED_PLATFORMS.join(", ")}` }, { status: 400 });
  }
  if (typeof style !== "string" || !ALLOWED_STYLES.includes(style)) {
    return NextResponse.json({ error: `\`style\` must be one of: ${ALLOWED_STYLES.join(", ")}` }, { status: 400 });
  }
  if (typeof tone !== "string" || !ALLOWED_TONES.includes(tone)) {
    return NextResponse.json({ error: `\`tone\` must be one of: ${ALLOWED_TONES.join(", ")}` }, { status: 400 });
  }

  const imageCount = Math.min(Math.max(Number(count) || 1, 1), 4);
  const size = PLATFORM_SIZE[platform];

  // Build an enriched prompt that incorporates style and tone context.
  const enrichedPrompt = `${style} style, ${tone.toLowerCase()} tone, optimized for ${platform}. ${prompt.trim()}. High quality, professional social media visual.`;

  const client = new OpenAI({ apiKey });

  try {
    // gpt-image-1 supports up to 4 images per request.
    const response = await client.images.generate({
      model: "gpt-image-1",
      prompt: enrichedPrompt,
      n: imageCount,
      size,
      quality: "high",
    });

    // gpt-image-1 returns base64 by default — convert to data URLs for the client.
    const images = (response.data ?? []).map((img) => ({
      url: img.url ?? (img.b64_json ? `data:image/png;base64,${img.b64_json}` : null),
    })).filter((img) => img.url !== null);

    return NextResponse.json({ images, platform, size }, { status: 200 });
  } catch (err) {
    console.error("generate-image error:", err);
    const message = err instanceof Error ? err.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
