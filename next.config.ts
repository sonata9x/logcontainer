import type { NextConfig } from "next";

function contentSecurityPolicy() {
  const connectSources = ["'self'"];
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      connectSources.push(url.origin, `${url.protocol === "https:" ? "wss:" : "ws:"}//${url.host}`);
    } catch {
      // The environment validator will surface an invalid URL at runtime.
    }
  }
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "media-src 'self' https:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "upgrade-insecure-requests"
  ].join("; ");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy() },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
      ]
    }];
  }
};

export default nextConfig;
