import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

const SHOTSTACK = {
  sandbox: { url: "https://api.shotstack.io/edit/stage/v1", key: process.env.SHOTSTACK_SANDBOX_KEY! },
  production: { url: "https://api.shotstack.io/edit/v1", key: process.env.SHOTSTACK_PROD_KEY! },
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const renderId = searchParams.get("renderId");
  const env = searchParams.get("env") === "production" ? "production" : "sandbox";

  if (!renderId) return NextResponse.json({ error: "renderId required." }, { status: 400 });

  const { url: shotUrl, key: apiKey } = SHOTSTACK[env];
  if (!apiKey) return NextResponse.json({ error: `SHOTSTACK_${env.toUpperCase()}_KEY not set.` }, { status: 500 });

  try {
    const res = await fetch(`${shotUrl}/render/${renderId}`, {
      headers: { "x-api-key": apiKey },
    });

    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { return NextResponse.json({ error: text }, { status: 500 }); }

    const data = json as {
      response?: {
        id: string;
        status: string;
        url?: string;
        error?: string;
      };
      message?: string;
    };

    if (!data.response) return NextResponse.json({ error: data.message ?? "No response from Shotstack." }, { status: 500 });

    return NextResponse.json({
      status: data.response.status,
      url: data.response.url ?? null,
      error: data.response.error ?? null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}
