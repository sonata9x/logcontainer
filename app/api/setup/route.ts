import { NextResponse } from "next/server";
import { createInternalAuthEmail, deriveAuthPassword, isValidUsername, normalizeUsername } from "@/lib/auth-identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { databaseErrorResponse } from "@/lib/api-error";
import { enforceRateLimit } from "@/lib/rate-limit";
import { timingSafeEqual } from "node:crypto";

function validSetupSecret(value: unknown) {
  const expected = process.env.SETUP_SECRET;
  if (!expected || typeof value !== "string") return false;
  const actualBuffer = Buffer.from(value, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!validSetupSecret(body.setupSecret)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const limited = await enforceRateLimit(request, { scope: "auth-setup", maxRequests: 5, windowSeconds: 3600, blockSeconds: 3600 });
  if (limited) return limited;
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim().slice(0, 80) : "";
  if (!isValidUsername(username) || password.length < 4) return NextResponse.json({ error: "아이디는 2~40자, 비밀번호는 4자 이상으로 입력해주세요." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  const { data: users, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (listError) return databaseErrorResponse(listError, "최초 설정 상태를 확인하지 못했습니다.");
  if (users.users.length) return NextResponse.json({ error: "최초 설정이 이미 완료되었습니다." }, { status: 409 });
  const { data, error } = await admin.auth.admin.createUser({ email: createInternalAuthEmail(), password: deriveAuthPassword(password), email_confirm: true, user_metadata: { username, display_name: displayName || username } });
  return error || !data.user ? databaseErrorResponse(error, "관리자를 만들지 못했습니다.") : NextResponse.json({ created: true }, { status: 201 });
}
