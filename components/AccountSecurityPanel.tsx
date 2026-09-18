"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SECURITY_ACTION_LABELS, type AccountSecurityEvent, type AccountSecurityOverview } from "@/lib/account-security-types";

export function AccountSecurityHistory({ events }: { events: AccountSecurityEvent[] }) {
  return <div className="account-security-history">{events.length ? <ol>{events.map((event) => <li key={event.id}><strong>{SECURITY_ACTION_LABELS[event.action] ?? "계정 보안 작업"}</strong>{event.previousUsername && <span>@{event.previousUsername} → @{event.nextUsername}</span>}<small>{new Date(event.createdAt).toLocaleString("ko-KR")}{event.actor ? ` · ${event.actor}` : ""}</small></li>)}</ol> : <p className="muted">아직 보안 변경 기록이 없습니다.</p>}</div>;
}

export function AccountSecurityPanel({ onPendingChange }: { onPendingChange?: (value: boolean) => void }) {
  const router = useRouter();
  const [overview, setOverview] = useState<AccountSecurityOverview | null>(null);
  const [operation, setOperation] = useState<"username" | "password" | "backup">("username");
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function load(signal?: AbortSignal) {
    const response = await fetch("/api/account/security", { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "계정 정보를 불러오지 못했습니다.");
    if (!signal?.aborted) { setOverview(result); setUsername(result.username ?? ""); }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "목록 오류"); }); return () => controller.abort(); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return;
    setError(""); setMessage("");
    if (operation === "password" && password !== confirm) { setError("새 비밀번호가 서로 다릅니다."); return; }
    setPending(true); onPendingChange?.(true); setCode("");
    try {
      const path = operation === "backup" ? "security" : operation;
      const response = await fetch(`/api/account/${path}`, { method: operation === "backup" ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ currentPassword, ...(operation === "username" ? { username } : operation === "password" ? { password } : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "변경하지 못했습니다.");
      setCurrentPassword(""); setPassword(""); setConfirm("");
      if (operation === "password") { window.location.assign("/login?password=changed"); return; }
      if (operation === "backup") { setCode(result.code); setMessage("새 복구 코드를 안전한 곳에 보관해주세요. 이전 코드는 무효입니다."); }
      else { setMessage("아이디를 변경했습니다. 다음 로그인부터 새 아이디를 사용하세요."); router.refresh(); }
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "요청을 처리하지 못했습니다."); }
    finally { setPending(false); onPendingChange?.(false); }
  }
  return <section className="account-security-panel"><p>현재 아이디 <strong>@{overview?.username ?? "…"}</strong></p><div className="settings-tabs" role="group" aria-label="계정 변경 종류">{[{ value: "username", label: "아이디" }, { value: "password", label: "비밀번호" }, { value: "backup", label: "복구 코드" }].map((tab) => <button key={tab.value} className={operation === tab.value ? "active" : ""} aria-pressed={operation === tab.value} disabled={pending} onClick={() => { setOperation(tab.value as typeof operation); setError(""); setMessage(""); setCode(""); setCurrentPassword(""); setPassword(""); setConfirm(""); }}>{tab.label}</button>)}</div><form onSubmit={submit}><fieldset disabled={pending || !overview}>{operation === "username" && <><label className="field">새 아이디<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={2} maxLength={40} required /></label><p className="muted">계정과 공유 권한은 유지됩니다. 이전 아이디는 다시 사용할 수 없으며, 이전 아이디를 대상으로 한 미수락 초대는 취소됩니다.</p></>}{operation === "password" && <><label className="field">새 비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={4} maxLength={200} autoComplete="new-password" required /></label><label className="field">새 비밀번호 확인<input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={4} maxLength={200} autoComplete="new-password" required /></label><p className="muted">변경 후 모든 기존 로그인 세션의 접근을 차단합니다. 새 비밀번호로 다시 로그인해주세요.</p></>}{operation === "backup" && <><p>비밀번호를 잊었을 때 사용할 일회용 코드입니다. 발급 시 한 번만 보여주며, 재발급 또는 비밀번호 변경·복구 시 이전 코드는 무효입니다.</p><p className="muted">{overview?.hasBackup ? "사용 가능한 복구 코드가 있습니다." : "현재 사용 가능한 복구 코드가 없습니다."} 사이트 관리자도 반드시 별도 보관을 권장합니다.</p></>}<label className="field">현재 비밀번호<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} minLength={4} autoComplete="current-password" required /></label><button className="button button-primary" disabled={pending || !overview}>{pending ? "처리 중…" : operation === "backup" ? "복구 코드 발급 / 재발급" : "변경"}</button></fieldset></form>{error && <p className="error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}{code && <div className="account-secret-box"><label className="field">개인 복구 코드<input readOnly value={code} aria-label="개인 복구 코드" /></label><p>이 코드를 가진 사람은 비밀번호를 재설정할 수 있습니다. 관리자나 다른 사람에게 보내지 마세요.</p><button className="button" onClick={async () => { try { await navigator.clipboard.writeText(code); setMessage("복구 코드를 복사했습니다."); } catch { setError("자동 복사가 안 됩니다. 코드를 직접 선택해 복사해주세요."); } }}>복사</button><button className="button" onClick={() => setCode("")}>화면에서 숨기기</button></div>}<details><summary>내 계정 보안 이력 · 최근 100건</summary><AccountSecurityHistory events={overview?.events ?? []} /></details></section>;
}
