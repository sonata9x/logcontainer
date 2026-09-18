import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { recoverySecretHash, runAccountPasswordUpdate, validRecoverySecret, validAccountPassword } from "@/lib/account-security";

export const maxDuration = 30;
export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, { scope: "auth-recovery", maxRequests: 5, windowSeconds: 900, blockSeconds: 1800 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  if (!validRecoverySecret(body.token) || !validAccountPassword(body.password)) return NextResponse.json({ error: "복구 코드와 4~200자 비밀번호를 확인해주세요." }, { status: 400 });
  try {
    await runAccountPasswordUpdate(createSupabaseAdminClient(), body.password, { recovery_hash: recoverySecretHash(body.token) });
    return NextResponse.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "복구하지 못했습니다. 관리자에게 새 링크를 요청해주세요." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
