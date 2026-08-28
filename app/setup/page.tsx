import { redirect } from "next/navigation";
import { SetupForm } from "@/components/SetupForm";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (!process.env.SETUP_SECRET) redirect("/login");
  const admin = createSupabaseAdminClient();
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (data?.users.length) redirect("/login");
  return <main className="auth-page"><section className="auth-card"><h1>서비스 최초 설정</h1><p>첫 계정은 자동 승인되며 가입 신청을 관리하는 사이트 관리자가 됩니다.</p><SetupForm /></section></main>;
}
