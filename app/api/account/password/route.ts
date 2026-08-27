import { NextResponse } from "next/server";
import { deriveAuthPassword } from "@/lib/auth-identity";
import { getApprovedApiContext } from "@/lib/api-auth";

export async function PATCH(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "승인된 계정으로 로그인해야 합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 4) return NextResponse.json({ error: "비밀번호는 4자 이상이어야 합니다." }, { status: 400 });
  const { error } = await context.supabase.auth.updateUser({ password: deriveAuthPassword(password) });
  return error ? NextResponse.json({ error: "비밀번호를 변경하지 못했습니다." }, { status: 400 }) : NextResponse.json({ updated: true });
}
