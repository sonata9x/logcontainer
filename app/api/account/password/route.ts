import { NextResponse } from "next/server";
import { deriveAuthPassword } from "@/lib/auth-identity";
import { getApprovedApiContext } from "@/lib/api-auth";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function PATCH(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "승인된 계정으로 로그인해야 합니다." }, { status: 401 });
  const limited = await enforceRateLimit(request, { scope: "auth-password-change", identity: context.user.id, maxRequests: 5, windowSeconds: 900, blockSeconds: 1800 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (currentPassword.length < 4 || password.length < 4) return NextResponse.json({ error: "현재 비밀번호와 4자 이상의 새 비밀번호를 입력해주세요." }, { status: 400 });
  if (!context.user.email) return NextResponse.json({ error: "계정 인증 정보를 확인하지 못했습니다." }, { status: 400 });
  const { error: authenticationError } = await context.supabase.auth.signInWithPassword({
    email: context.user.email,
    password: deriveAuthPassword(currentPassword)
  });
  if (authenticationError) return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 401 });
  const { error } = await context.supabase.auth.updateUser({ password: deriveAuthPassword(password) });
  return error ? NextResponse.json({ error: "비밀번호를 변경하지 못했습니다." }, { status: 400 }) : NextResponse.json({ updated: true });
}
