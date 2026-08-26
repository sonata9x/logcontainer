"use client";

import { FormEvent, useState } from "react";

export function SetupForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName: form.get("displayName"), username: form.get("username"), password: form.get("password") }) });
    const result = await response.json();
    if (!response.ok) { setError(result.error ?? "설정을 완료하지 못했습니다."); setPending(false); return; }
    window.location.assign("/login");
  }
  return <form onSubmit={submit}><label className="field">아이디<input name="username" autoComplete="username" minLength={2} maxLength={40} required /></label><label className="field">표시 이름<input name="displayName" maxLength={80} /></label><label className="field">비밀번호<input name="password" type="password" minLength={4} required /></label>{error && <p className="error">{error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "만드는 중…" : "소유자 계정 만들기"}</button></form>;
}
