import { redirect } from "next/navigation";
import { SetupForm } from "@/components/SetupForm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (data?.users.length) redirect("/login");
  return <main className="auth-page"><section className="auth-card"><h1>첫 워크스페이스 만들기</h1><p>이 화면은 사용자가 아직 한 명도 없을 때만 열립니다.</p><SetupForm /></section></main>;
}
