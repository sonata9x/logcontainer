"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

export function SignupForm() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("passwordConfirm")) {
      setMessage("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setPending(true);
    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: form.get("username"), displayName: form.get("displayName"), password: form.get("password") })
    });
    const result = await response.json();
    setPending(false);
    setSuccess(response.ok);
    setMessage(response.ok ? "가입 신청이 완료되었습니다. 관리자의 승인 후 로그인할 수 있습니다." : result.error ?? "가입 신청을 완료하지 못했습니다.");
    if (response.ok) event.currentTarget.reset();
  }

  return <form onSubmit={submit}>
    <label className="field">아이디<input name="username" autoComplete="username" minLength={2} maxLength={40} required /></label>
    <label className="field">표시 이름<input name="displayName" maxLength={80} required /></label>
    <label className="field">비밀번호<input name="password" type="password" autoComplete="new-password" minLength={4} required /></label>
    <label className="field">비밀번호 확인<input name="passwordConfirm" type="password" autoComplete="new-password" minLength={4} required /></label>
    {message && <p className={success ? "success" : "error"}>{message}</p>}
    <button className="button button-primary" disabled={pending}>{pending ? "신청 중…" : "가입 신청"}</button>
    <p className="auth-footnote"><Link href="/login">로그인으로 돌아가기</Link></p>
  </form>;
}
