import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  distDir: process.env.NEXT_DIST_DIR || ".next"
};

export default nextConfig;
