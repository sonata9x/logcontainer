import { NextResponse } from "next/server";
import { deriveAuthPassword, isValidUsername, normalizeUsername } from "@/lib/auth-identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { recordAccountSecurityEvent } from "@/lib/account-security";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, { scope: "auth-login", maxRequests: 10, windowSeconds: 300, blockSeconds: 900 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidUsername(username) || password.length < 4) {
    return NextResponse.json({ error: "아이디 또는 비밀번호를 확인해주세요." }, { status: 400 });
  }

  const accountLimited = await enforceRateLimit(request, { scope: "auth-login-account", identity: username, identityOnly: true, maxRequests: 10, windowSeconds: 300, blockSeconds: 900 });
  if (accountLimited) return accountLimited;
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from("profiles").select("id, account_status").eq("username", username).maybeSingle();
  if (!profile) return NextResponse.json({ error: "아이디 또는 비밀번호를 확인해주세요." }, { status: 401 });
  const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
  const email = authUser.user?.email;
  if (!email) return NextResponse.json({ error: "아이디 또는 비밀번호를 확인해주세요." }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: deriveAuthPassword(password) });
  if (error) { await recordAccountSecurityEvent(profile.id, "login_failed"); return NextResponse.json({ error: "아이디 또는 비밀번호를 확인해주세요." }, { status: 401 }); }
  if (profile.account_status !== "approved") {
    await supabase.auth.signOut();
    const message = profile.account_status === "pending"
      ? "관리자 승인 대기 중인 계정입니다."
      : profile.account_status === "rejected"
        ? "가입 신청이 승인되지 않은 계정입니다."
        : "현재 사용할 수 없는 계정입니다.";
    return NextResponse.json({ error: message }, { status: 403 });
  }
  const { data: sessionValid, error: sessionError } = await supabase.rpc("account_session_valid");
  if (sessionError || sessionValid !== true) {
    await supabase.auth.signOut({ scope: "local" });
    return NextResponse.json({ error: "계정 보안 처리가 진행 중입니다. 관리자에게 문의해주세요." }, { status: 403 });
  }
  return NextResponse.json({ signedIn: true });
}
