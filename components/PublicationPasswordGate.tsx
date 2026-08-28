"use client";

import { FormEvent, useState } from "react";

export function PublicationPasswordGate({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/publications/${encodeURIComponent(token)}/password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: form.get("password") }) });
    const result = await response.json(); setPending(false);
    if (!response.ok) return setError(result.error ?? "비밀번호를 확인하지 못했습니다.");
    window.location.reload();
  }
  return <main className="guest-auth"><form className="modal-card" onSubmit={unlock}><h1>비밀글</h1><p>게시물을 보려면 비밀번호를 입력하세요.</p><label className="field">비밀번호<input name="password" type="password" required autoFocus disabled={pending} /></label>{error && <p className="error">{error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "확인 중…" : "확인"}</button></form></main>;
}
