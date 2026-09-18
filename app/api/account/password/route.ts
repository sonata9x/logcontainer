import { NextResponse } from "next/server";
import { getApprovedApiContext } from "@/lib/api-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runAccountPasswordUpdate, validAccountPassword, validCurrentAccountPassword, verifyAccountPassword, recordReauthenticationFailure, recordAccountSecurityEvent } from "@/lib/account-security";

export const maxDuration = 30;
export async function PATCH(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "승인된 계정으로 로그인해야 합니다." }, { status: 401 });
  const limited = await enforceRateLimit(request, { scope: "auth-password-change", identity: context.user.id, identityOnly: true, maxRequests: 5, windowSeconds: 900, blockSeconds: 1800 });
  if (limited) { if (limited.status === 429) await recordAccountSecurityEvent(context.user.id, "request_limited", context.user.id); return limited; }
  const body = await request.json().catch(() => ({}));
  if (!validCurrentAccountPassword(body.currentPassword) || !validAccountPassword(body.password)) return NextResponse.json({ error: "현재 비밀번호를 확인하고 새 비밀번호는 4~200자로 입력해주세요." }, { status: 400 });
  try {
    if (!await verifyAccountPassword(context.user.id, body.currentPassword)) { await recordReauthenticationFailure(context.user.id); return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 }); }
    await runAccountPasswordUpdate(createSupabaseAdminClient(), body.password, { target_user_id: context.user.id });
    await context.supabase.auth.signOut({ scope: "local" });
    return NextResponse.json({ updated: true, signInRequired: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "비밀번호를 변경하지 못했습니다." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
}
