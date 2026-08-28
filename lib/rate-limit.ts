import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RateLimitOptions = {
  scope: string;
  maxRequests: number;
  windowSeconds: number;
  blockSeconds: number;
  identity?: string;
};

function requestAddress(request: Request) {
  // Vercel sets this to the verified client address. Prefer it when a custom
  // proxy sits in front of Vercel, then fall back to Vercel's X-Forwarded-For.
  const forwarded = (request.headers.get("x-vercel-forwarded-for") || request.headers.get("x-forwarded-for"))
    ?.split(",")[0]
    ?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function rateLimitSecret() {
  return process.env.RATE_LIMIT_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export async function enforceRateLimit(request: Request, options: RateLimitOptions) {
  const secret = rateLimitSecret();
  if (!secret) {
    return NextResponse.json({ error: "보안 설정을 확인해주세요." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  const identity = `${requestAddress(request)}\0${options.identity ?? ""}`;
  const keyHash = createHmac("sha256", secret).update(identity, "utf8").digest("hex");
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("consume_security_rate_limit", {
    rate_key_hash: keyHash,
    rate_scope: options.scope,
    window_seconds: options.windowSeconds,
    max_requests: options.maxRequests,
    block_seconds: options.blockSeconds
  });

  if (error || !data || typeof data !== "object") {
    console.error("[security-rate-limit] unavailable", { scope: options.scope, code: error?.code ?? "invalid-result" });
    return NextResponse.json({ error: "요청 보호 기능을 사용할 수 없습니다. 잠시 후 다시 시도해주세요." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "Retry-After": "30" }
    });
  }

  const result = data as { allowed?: boolean; retryAfter?: number };
  if (result.allowed) return null;
  const retryAfter = Math.max(1, Math.ceil(Number(result.retryAfter) || options.blockSeconds));
  return NextResponse.json({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }, {
    status: 429,
    headers: { "Cache-Control": "no-store", "Retry-After": String(retryAfter) }
  });
}
