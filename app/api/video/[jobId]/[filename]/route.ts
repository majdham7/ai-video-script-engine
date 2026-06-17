import { NextRequest, NextResponse } from "next/server";
import fsp from "fs/promises";
import fs from "fs";
import path from "path";

// Serves the final generated video from /tmp/engine-videos/<jobId>/<filename>.
// The URL is produced by the generate-video route and given to the client.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string; filename: string }> }
) {
  const { jobId, filename } = await params;

  // Sanitise both path segments to prevent directory traversal.
  const safeJobId = path.basename(jobId);
  const safeFilename = path.basename(filename);

  const filePath = path.join("/tmp", "engine-videos", safeJobId, safeFilename);

  try {
    await fsp.access(filePath, fs.constants.F_OK);
  } catch {
    return NextResponse.json({ error: "Video not found." }, { status: 404 });
  }

  const stat = await fsp.stat(filePath);
  const fileStream = fs.createReadStream(filePath);

  return new Response(fileStream as unknown as ReadableStream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size.toString(),
      "Content-Disposition": `inline; filename="${safeFilename}"`,
    },
  });
}
