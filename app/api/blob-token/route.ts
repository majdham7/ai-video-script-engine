import { NextRequest, NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";

export const maxDuration = 10;

export async function POST(req: NextRequest) {
  try {
    const { filename } = await req.json() as { filename: string };
    const pathname = `uploads/${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN!,
      pathname,
      onUploadCompleted: {
        callbackUrl: `${req.nextUrl.origin}/api/blob-token/callback`,
        tokenPayload: "",
      },
    });

    return NextResponse.json({ clientToken, pathname });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Token generation failed." }, { status: 500 });
  }
}
