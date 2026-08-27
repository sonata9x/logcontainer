import { SignupForm } from "@/components/SignupForm";

export default function SignupPage() {
  return <main className="auth-page"><section className="auth-card">
    <h1>회원가입</h1>
    <p>계정을 신청하면 사이트 관리자가 확인합니다. 승인되기 전에는 로그인할 수 없습니다.</p>
    <SignupForm />
  </section></main>;
}
