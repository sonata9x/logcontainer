import { NextResponse } from "next/server";
import { getApprovedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse, internalErrorResponse } from "@/lib/api-error";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createRecoverySecret, recoverySecretHash, verifyAccountPassword, recordReauthenticationFailure, recordAccountSecurityEvent } from "@/lib/account-security";

export async function GET() {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.supabase.rpc("account_security_overview", { target_user_id: context.user.id });
  return error ? databaseErrorResponse(error, "계정 보안 정보를 불러오지 못했습니다.") : NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const limited = await enforceRateLimit(request, { scope: "auth-backup-code", identity: context.user.id, identityOnly: true, maxRequests: 5, windowSeconds: 900, blockSeconds: 1800 });
  if (limited) { if (limited.status === 429) await recordAccountSecurityEvent(context.user.id, "request_limited", context.user.id); return limited; }
  const body = await request.json().catch(() => ({}));
  try {
    if (!await verifyAccountPassword(context.user.id, body.currentPassword)) { await recordReauthenticationFailure(context.user.id); return NextResponse.json({ error: "현재 비밀번호를 확인해주세요." }, { status: 401 }); }
    const secret = createRecoverySecret();
    const { error } = await createSupabaseAdminClient().rpc("issue_account_recovery", { target_user_id: context.user.id, actor_id: context.user.id, next_token_hash: recoverySecretHash(secret), token_kind: "backup" });
    return error ? databaseErrorResponse(error, "복구 코드를 발급하지 못했습니다.") : NextResponse.json({ code: secret }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return internalErrorResponse(error, "계정 인증을 확인하지 못했습니다."); }
}
