"use client";

import { X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useEscapeClose } from "@/lib/use-escape-close";
import type { AccountSecurityOverview, RecoveryLinkInfo } from "@/lib/account-security-types";
import { AccountSecurityHistory } from "@/components/AccountSecurityPanel";

export function AdminAccountSecurityDialog({ userId, username, isOwnAccount, approved, onClose }: { userId: string; username: string; isOwnAccount: boolean; approved: boolean; onClose: () => void }) {
  const [overview, setOverview] = useState<AccountSecurityOverview | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 15_000); return () => window.clearInterval(timer); }, []);
  useEscapeClose(() => { if (!pending) onClose(); });
  const endpoint = `/api/admin/accounts/${userId}/security`;
  async function load(signal?: AbortSignal) {
    const response = await fetch(endpoint, { cache: "no-store", signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "계정 정보를 불러오지 못했습니다.");
    if (!signal?.aborted) setOverview(result);
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal).catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "목록 오류"); }); return () => controller.abort(); }, [endpoint]); // eslint-disable-line react-hooks/exhaustive-deps
  async function act(action: "issue" | "revoke" | "abort", tokenId?: string) {
    if (pending) return;
    setPending(true); setError(""); setCopied(false); setLink("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, tokenId, currentPassword }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "처리하지 못했습니다.");
      setCurrentPassword("");
      if (result.path) { setLink(new URL(result.path, window.location.origin).href); setExpiresAt(result.expiresAt); }
      await load();
    } catch (error) { setError(error instanceof Error ? error.message : "요청 오류"); }
    finally { setPending(false); }
  }
  function linkStatus(item: RecoveryLinkInfo) { return item.usedAt ? "사용됨" : item.revokedAt ? "취소됨" : Date.parse(item.expiresAt) <= now ? "만료됨" : "사용 가능"; }
  return createPortal(<div className="modal-backdrop" onMouseDown={() => !pending && onClose()}><section className="modal-card settings-modal" role="dialog" aria-modal="true" aria-label={`@${username} 계정 보안`} onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label="닫기" disabled={pending} onClick={onClose}><X size={17} /></button><h2>@{username} 계정 보안</h2>{isOwnAccount ? <p>본인 비밀번호 복구는 설정 → 계정에서 미리 발급한 개인 복구 코드를 사용하세요.</p> : approved && <form onSubmit={(event: FormEvent) => { event.preventDefault(); void act("issue"); }}><p>평소 연락 채널에서 본인을 확인한 뒤 전달하세요. 링크는 30분간 한 번만 사용 가능하며 재발급하면 이전 링크는 무효입니다.</p><label className="field">관리자 현재 비밀번호<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} minLength={4} required autoComplete="current-password" disabled={pending} /></label><button className="button button-primary" disabled={pending || !overview || Boolean(overview.pendingSince)}>{pending ? "처리 중…" : "복구 링크 발급 / 재발급"}</button>{overview?.pendingSince && <p className="error">비밀번호 작업이 진행 중이거나 중단되었습니다. 시작: {new Date(overview.pendingSince).toLocaleString("ko-KR")}<button className="button" type="button" disabled={pending || !currentPassword || now - Date.parse(overview.pendingSince) < 900_000} onClick={() => void act("abort")}>15분 이상 중단된 처리 해제</button></p>}</form>}{link && <div className="account-secret-box"><label className="field">복구 링크<input readOnly value={link} /></label><small>만료 {new Date(expiresAt).toLocaleString("ko-KR")} · 링크 원문은 이 창에서만 확인할 수 있습니다.</small><button className="button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setError("링크를 직접 선택해 복사해주세요."); } }}>{copied ? "복사됨" : "링크 복사"}</button></div>}{error && <p className="error" role="alert">{error}</p>}<h3>복구 링크 기록</h3><ul className="account-recovery-list">{overview?.links.map((item) => <li key={item.id}><span>{new Date(item.createdAt).toLocaleString("ko-KR")} · {linkStatus(item)}</span>{!isOwnAccount && linkStatus(item) === "사용 가능" && <button className="button" disabled={pending || !currentPassword} onClick={() => void act("revoke", item.id)}>취소</button>}</li>)}</ul><h3>보안 이력 · 최근 100건</h3><AccountSecurityHistory events={overview?.events ?? []} /></section></div>, document.body);
}
