import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const ALLOWED_STYLES = [
  "TikTok Ad",
  "Cinematic",
  "Documentary",
  "Luxury Brand",
  "Funny Meme",
  "Startup Promo",
] as const;

// Target scene counts per length selection.
const LENGTH_SCENE_COUNT: Record<string, number> = {
  "30s": 3,
  "60s": 5,
  "90s": 8,
  "2min": 10,
};

interface Scene {
  startTime: string;
  endTime: string;
  voiceoverText: string;
  visualPrompt: string;
  brollIdeas: string[];
  captionText: string;
  cameraMovement: string;
  editingNotes: string;
  soundEffects: string[];
}

interface VideoPlan {
  videoTitle: string;
  overallTheme: string;
  musicStyle: string;
  colorPalette: string[];
  scenes: Scene[];
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY environment variable is not set");
  return new OpenAI({ apiKey });
}

export async function POST(req: NextRequest) {
  let body: { script?: unknown; style?: unknown; length?: unknown };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const { script, style, length = "60s" } = body;

  if (typeof script !== "string" || script.trim().length === 0) {
    return NextResponse.json(
      { error: "`script` is required and must be a non-empty string." },
      { status: 400 }
    );
  }

  if (typeof style !== "string" || !ALLOWED_STYLES.includes(style as (typeof ALLOWED_STYLES)[number])) {
    return NextResponse.json(
      { error: `\`style\` must be one of: ${ALLOWED_STYLES.join(", ")}` },
      { status: 400 }
    );
  }

  const sceneCount = LENGTH_SCENE_COUNT[length as string] ?? 5;

  let client: OpenAI;
  try {
    client = getOpenAIClient();
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  const systemPrompt = `You are an expert video director and storyboard planner.
Given a script, style, and target length, break the script into exactly ${sceneCount} scenes.
Respond with ONLY valid JSON (no markdown, no code fences) matching this shape:

{
  "videoTitle": string,
  "overallTheme": string,
  "musicStyle": string,
  "colorPalette": string[], // exactly 5 hex color codes e.g. "#1a1a2e"
  "scenes": [
    {
      "startTime": string,     // e.g. "0:00"
      "endTime": string,       // e.g. "0:10"
      "voiceoverText": string,
      "visualPrompt": string,
      "brollIdeas": string[],
      "captionText": string,
      "cameraMovement": string,
      "editingNotes": string,
      "soundEffects": string[]
    }
  ]
}

Target video length: ${length} (${sceneCount} scenes).
Tailor tone, pacing, visuals, and music to the requested style.`;

  const userPrompt = `Style: ${style}\nLength: ${length}\n\nScript:\n${script}`;

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return NextResponse.json({ error: "Model returned an empty response." }, { status: 502 });

    let plan: VideoPlan;
    try {
      plan = JSON.parse(raw) as VideoPlan;
    } catch {
      return NextResponse.json({ error: "Model returned malformed JSON." }, { status: 502 });
    }

    return NextResponse.json(plan, { status: 200 });
  } catch (err) {
    console.error("generate-video-plan error:", err);
    return NextResponse.json({ error: "Failed to generate video plan. Please try again." }, { status: 500 });
  }
}
