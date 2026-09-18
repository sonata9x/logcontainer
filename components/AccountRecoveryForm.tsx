"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

export function AccountRecoveryForm() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { const value = new URLSearchParams(window.location.hash.slice(1)).get("token"); if (value) { setToken(value); window.history.replaceState(null, "", window.location.pathname); } }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    setError("");
    if (password !== confirm) { setError("새 비밀번호가 서로 다릅니다."); return; }
    setPending(true);
    try {
      const response = await fetch("/api/account/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token.trim(), password }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "복구하지 못했습니다.");
      setToken(""); setPassword(""); setConfirm(""); setDone(true);
    } catch (error) { setError(error instanceof Error ? error.message : "요청을 처리하지 못했습니다."); }
    finally { setPending(false); }
  }
  if (done) return <div><p role="status">비밀번호를 재설정했습니다. 새 비밀번호로 로그인한 뒤 설정 → 계정에서 새 개인 복구 코드를 발급해주세요.</p><Link className="button button-primary" href="/login">로그인</Link></div>;
  return <form onSubmit={submit}><p>관리자에게 받은 링크를 열거나, 미리 보관한 개인 복구 코드를 입력해주세요. 둘 다 없다면 평소 연락 채널로 관리자에게 요청하세요.</p><label className="field">복구 코드<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" spellCheck={false} required disabled={pending} /></label><label className="field">새 비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={4} maxLength={200} autoComplete="new-password" required disabled={pending} /></label><label className="field">새 비밀번호 확인<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={4} maxLength={200} autoComplete="new-password" required disabled={pending} /></label>{error && <p className="error" role="alert">{error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "재설정 중…" : "비밀번호 재설정"}</button><p><Link href="/login">로그인으로 돌아가기</Link></p></form>;
}
