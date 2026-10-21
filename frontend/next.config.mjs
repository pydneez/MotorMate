import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // A self-contained server (.next/standalone) for the Docker image — see frontend/Dockerfile.
  output: "standalone",
  experimental: {
    // Trace from the repo root so the workspace package @motormate/types is included.
    outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), ".."),
  },
};

export default nextConfig;
