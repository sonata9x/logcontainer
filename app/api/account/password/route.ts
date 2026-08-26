import { NextResponse } from "next/server";
import { deriveAuthPassword } from "@/lib/auth-identity";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function PATCH(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 4) return NextResponse.json({ error: "비밀번호는 4자 이상이어야 합니다." }, { status: 400 });
  const { error } = await supabase.auth.updateUser({ password: deriveAuthPassword(password) });
  return error ? NextResponse.json({ error: "비밀번호를 변경하지 못했습니다." }, { status: 400 }) : NextResponse.json({ updated: true });
}
