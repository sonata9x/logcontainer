"use client";

import { FormEvent, useState } from "react";

export function SetPasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    if (password.length < 4 || password !== confirm) {
      setError(password.length < 4 ? "비밀번호는 4자 이상이어야 합니다." : "비밀번호가 서로 다릅니다.");
      setPending(false);
      return;
    }
    const response = await fetch("/api/account/password", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    if (!response.ok) {
      setError("비밀번호를 변경하지 못했습니다.");
      setPending(false);
      return;
    }
    window.location.assign("/workspace");
  }
  return <form onSubmit={submit}><label className="field">새 비밀번호<input name="password" type="password" minLength={4} required /></label><label className="field">비밀번호 확인<input name="confirm" type="password" minLength={4} required /></label>{error && <p className="error">{error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "설정 중…" : "비밀번호 설정"}</button></form>;
}
