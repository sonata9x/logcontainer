import { NextResponse } from "next/server";
import { getApprovedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse, internalErrorResponse } from "@/lib/api-error";
import { enforceRateLimit } from "@/lib/rate-limit";
import { isValidUsername, normalizeUsername } from "@/lib/auth-identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyAccountPassword, recordReauthenticationFailure, recordAccountSecurityEvent } from "@/lib/account-security";

export async function PATCH(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const limited = await enforceRateLimit(request, { scope: "auth-username-change", identity: context.user.id, identityOnly: true, maxRequests: 5, windowSeconds: 900, blockSeconds: 1800 });
  if (limited) { if (limited.status === 429) await recordAccountSecurityEvent(context.user.id, "request_limited", context.user.id); return limited; }
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  if (!isValidUsername(username)) return NextResponse.json({ error: "아이디는 소문자 영문·숫자·한글·._- 조합 2~40자로 입력해주세요." }, { status: 400 });
  try {
    if (!await verifyAccountPassword(context.user.id, body.currentPassword)) { await recordReauthenticationFailure(context.user.id); return NextResponse.json({ error: "현재 비밀번호를 확인해주세요." }, { status: 401 }); }
    const { data, error } = await createSupabaseAdminClient().rpc("change_account_username", { target_user_id: context.user.id, next_username: username });
    return error ? databaseErrorResponse(error, "사용 중이거나 이전에 사용된 아이디입니다. 계정 처리 중이라면 잠시 후 시도해주세요.", 409) : NextResponse.json({ username: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return internalErrorResponse(error, "아이디를 변경하지 못했습니다."); }
}
