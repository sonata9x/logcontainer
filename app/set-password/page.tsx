import { redirect } from "next/navigation";
import { SetPasswordForm } from "@/components/SetPasswordForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SetPasswordPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <main className="auth-page"><section className="auth-card"><h1>비밀번호 설정</h1><p>앞으로 이 워크스페이스에 로그인할 때 사용할 비밀번호입니다.</p><SetPasswordForm /></section></main>;
}
