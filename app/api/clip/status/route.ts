import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const apiKey = process.env.OPUS_CLIP_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPUS_CLIP_API_KEY not set." }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required." }, { status: 400 });

  try {
    const res = await fetch(
      `https://api.opus.pro/api/exportable-clips?q=findByProjectId&projectId=${projectId}&pageSize=20`,
      { headers: { Authorization: apiKey } }
    );
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { return NextResponse.json({ error: text }, { status: 500 }); }

    const data = json as {
      errorMessage?: string;
      data?: Array<{
        id: string;
        title?: string;
        clipScore?: number;
        duration?: number;
        uriForPreview?: string;
        uriForExport?: string;
        status?: string;
      }>;
      total?: number;
    };

    if (data.errorMessage) return NextResponse.json({ error: data.errorMessage }, { status: 500 });

    const clips = (data.data ?? []).map((c) => ({
      id: c.id,
      title: c.title ?? "Clip",
      score: c.clipScore ?? 0,
      duration: c.duration ?? 0,
      previewUrl: c.uriForPreview ?? null,
      downloadUrl: c.uriForExport ?? null,
      status: c.status ?? "processing",
    }));

    const ready = clips.filter((c) => c.downloadUrl);
    return NextResponse.json({ clips, ready: ready.length, total: data.total ?? 0 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}
