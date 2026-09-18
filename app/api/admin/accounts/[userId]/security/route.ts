import { NextResponse } from "next/server";
import { getSiteAdminApiContext } from "@/lib/admin-auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { databaseErrorResponse, internalErrorResponse } from "@/lib/api-error";
import { createRecoverySecret, recoverySecretHash, verifyAccountPassword, recordReauthenticationFailure, recordAccountSecurityEvent } from "@/lib/account-security";

type Params = { params: Promise<{ userId: string }> };
export async function GET(_request: Request, { params }: Params) {
  const context = await getSiteAdminApiContext();
  if (!context) return NextResponse.json({ error: "사이트 관리자만 접근할 수 있습니다." }, { status: 403 });
  const { userId } = await params;
  const { data, error } = await context.supabase.rpc("account_security_overview", { target_user_id: userId });
  return error ? databaseErrorResponse(error, "보안 정보를 불러오지 못했습니다.") : NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request, { params }: Params) {
  const context = await getSiteAdminApiContext();
  if (!context) return NextResponse.json({ error: "사이트 관리자만 접근할 수 있습니다." }, { status: 403 });
  const { userId } = await params;
  const limited = await enforceRateLimit(request, { scope: "admin-account-recovery", identity: context.user.id, identityOnly: true, maxRequests: 5, windowSeconds: 900, blockSeconds: 1800 });
  if (limited) { if (limited.status === 429) await recordAccountSecurityEvent(context.user.id, "request_limited", context.user.id); return limited; }
  const body = await request.json().catch(() => ({}));
  if (!["issue", "revoke", "abort"].includes(body.action)) return NextResponse.json({ error: "올바르지 않은 작업입니다." }, { status: 400 });
  try {
    if (!await verifyAccountPassword(context.user.id, body.currentPassword)) { await recordReauthenticationFailure(context.user.id); return NextResponse.json({ error: "관리자 비밀번호를 확인해주세요." }, { status: 401 }); }
    if (body.action === "issue") {
      const token = createRecoverySecret();
      const { data, error } = await context.admin.rpc("issue_account_recovery", { target_user_id: userId, actor_id: context.user.id, next_token_hash: recoverySecretHash(token), token_kind: "link" });
      return error ? databaseErrorResponse(error, "복구 링크를 발급하지 못했습니다. 승인 상태와 진행 중 작업을 확인해주세요.") : NextResponse.json({ ...data, path: `/recover#token=${token}` }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "revoke") {
      const { data: link } = await context.admin.from("account_recovery_tokens").select("id").eq("id", body.tokenId).eq("user_id", userId).eq("kind", "link").maybeSingle();
      if (!link) return NextResponse.json({ error: "복구 링크를 찾지 못했습니다." }, { status: 404 });
      const { error } = await context.admin.rpc("revoke_account_recovery", { target_token_id: link.id, actor_id: context.user.id });
      return error ? databaseErrorResponse(error, "복구 링크를 취소하지 못했습니다.") : NextResponse.json({ updated: true });
    }
    const { error } = await context.admin.rpc("abort_account_password_update", { target_user_id: userId, actor_id: context.user.id });
    return error ? databaseErrorResponse(error, "중단할 수 없습니다. 처리 시작 후 15분이 지나야 합니다.") : NextResponse.json({ updated: true });
  } catch (error) { return internalErrorResponse(error, "계정 보안 작업을 처리하지 못했습니다."); }
}
