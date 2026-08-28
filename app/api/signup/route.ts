import { NextResponse } from "next/server";
import { createInternalAuthEmail, deriveAuthPassword, isValidUsername, normalizeUsername } from "@/lib/auth-identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { databaseErrorResponse } from "@/lib/api-error";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, { scope: "auth-signup", maxRequests: 5, windowSeconds: 3600, blockSeconds: 3600 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";
  if (!isValidUsername(username) || !displayName || password.length < 4) {
    return NextResponse.json({ error: "아이디는 2~40자, 닉네임은 필수, 비밀번호는 4자 이상으로 입력해주세요." }, { status: 400 });
  }
  const admin = createSupabaseAdminClient();
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (usersError) return databaseErrorResponse(usersError, "가입 상태를 확인하지 못했습니다.");
  if (!users.users.length) return NextResponse.json({ error: "먼저 /setup에서 최초 관리자 계정을 만들어주세요." }, { status: 409 });
  const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) return NextResponse.json({ error: "이미 사용 중인 아이디입니다." }, { status: 409 });
  const { data, error } = await admin.auth.admin.createUser({
    email: createInternalAuthEmail(),
    password: deriveAuthPassword(password),
    email_confirm: true,
    user_metadata: { username, display_name: displayName }
  });
  if (error || !data.user) return databaseErrorResponse(error, "가입 신청을 만들지 못했습니다.");
  return NextResponse.json({ created: true, status: "pending" }, { status: 201 });
}
