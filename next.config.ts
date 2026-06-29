import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep ffmpeg's native binary resolution out of the webpack/turbopack bundle —
  // its dynamic per-platform requires break static analysis otherwise.
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg", "fluent-ffmpeg"],
};

export default nextConfig;
