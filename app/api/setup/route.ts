import { NextResponse } from "next/server";
import { createInternalAuthEmail, deriveAuthPassword, isValidUsername, normalizeUsername } from "@/lib/auth-identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";
  if (!isValidUsername(username) || password.length < 4) return NextResponse.json({ error: "아이디는 2~40자, 비밀번호는 4자 이상으로 입력해주세요." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 400 });
  if (users.users.length) return NextResponse.json({ error: "최초 설정이 이미 완료되었습니다." }, { status: 409 });
  const { data, error } = await admin.auth.admin.createUser({ email: createInternalAuthEmail(), password: deriveAuthPassword(password), email_confirm: true, user_metadata: { username, display_name: displayName || username } });
  return error || !data.user ? NextResponse.json({ error: error?.message ?? "소유자를 만들지 못했습니다." }, { status: 400 }) : NextResponse.json({ created: true }, { status: 201 });
}
