import { SetPasswordForm } from "@/components/SetPasswordForm";
import { requireApprovedSession } from "@/lib/auth";

export default async function SetPasswordPage() {
  await requireApprovedSession();
  return <main className="auth-page"><section className="auth-card"><h1>비밀번호 설정</h1><p>앞으로 이 워크스페이스에 로그인할 때 사용할 비밀번호입니다.</p><SetPasswordForm /></section></main>;
}
