import { NextResponse } from "next/server";
import { deriveAuthPassword, isValidUsername, normalizeUsername } from "@/lib/auth-identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidUsername(username) || password.length < 4) {
    return NextResponse.json({ error: "아이디 또는 비밀번호를 확인해주세요." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (!profile) return NextResponse.json({ error: "아이디 또는 비밀번호를 확인해주세요." }, { status: 401 });
  const { data: authUser } = await admin.auth.admin.getUserById(profile.id);
  const email = authUser.user?.email;
  if (!email) return NextResponse.json({ error: "아이디 또는 비밀번호를 확인해주세요." }, { status: 401 });
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password: deriveAuthPassword(password) });
  return error
    ? NextResponse.json({ error: "아이디 또는 비밀번호를 확인해주세요." }, { status: 401 })
    : NextResponse.json({ signedIn: true });
}
