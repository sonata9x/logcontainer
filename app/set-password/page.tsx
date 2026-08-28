import { SetPasswordForm } from "@/components/SetPasswordForm";
import { requireApprovedSession } from "@/lib/auth";

export default async function SetPasswordPage() {
  await requireApprovedSession();
  return <main className="auth-page"><section className="auth-card"><h1>비밀번호 변경</h1><p>현재 비밀번호를 확인한 뒤 새 비밀번호로 변경합니다.</p><SetPasswordForm /></section></main>;
}
