import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function LoginPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/workspace");

  return (
    <main className="auth-page">
      <section className="auth-card">
        <h1>TRPG Workspace</h1>
        <p>로그를 백업하고 함께 다듬은 뒤, 완성된 로그 한 페이지만 게시합니다.</p>
        <LoginForm />
        <p className="auth-footnote"><Link href="/setup">처음 설정하는 경우</Link></p>
      </section>
    </main>
  );
}
