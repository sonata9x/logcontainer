"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Download, LogOut, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { LogEntryBlock } from "@/components/LogEntryBlock";
import { editableTextSegments, styledContentTargets } from "@/lib/logs/model/user-edit";
import { styleToEditorText } from "@/lib/logs/model/editor";
import type { LogEntry } from "@/lib/types";
import { ExportDialog } from "@/components/ExportDialog";
import { useEscapeClose } from "@/lib/use-escape-close";

type GuestPayload = { page: { id: string; title: string }; participant: { id: string; nickname: string; accessLevel: "viewer" | "editor" }; entries: LogEntry[]; totalCount: number; canEdit: boolean; eventCursor: number };

export function GuestLog({ token }: { token: string }) {
  const [payload, setPayload] = useState<GuestPayload | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [trash, setTrash] = useState<LogEntry[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const cursor = useRef(0);
  useEscapeClose(() => setTrash(null), pending || !trash);

  const load = useCallback(async () => {
    const response = await fetch(`/api/share/${encodeURIComponent(token)}/log`, { cache: "no-store" });
    if (response.status === 401) { setAuthRequired(true); setPayload(null); setLoading(false); return; }
    const result = await response.json();
    if (!response.ok) { setError(result.error ?? "Guest 로그를 불러오지 못했습니다."); setLoading(false); return; }
    setPayload(result); cursor.current = result.eventCursor ?? 0; setAuthRequired(false); setLoading(false);
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!payload) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const response = await fetch(`/api/share/${encodeURIComponent(token)}/changes?after=${cursor.current}`, { cache: "no-store" });
      if (response.status === 401) { setAuthRequired(true); setPayload(null); return; }
      if (!response.ok) return;
      const result = await response.json();
      const events = result.events ?? [];
      for (const event of events) {
        cursor.current = Math.max(cursor.current, Number(event.id));
        if (event.event_type === "log_replaced") { await load(); return; }
        if (!event.entry_id) continue;
        if (event.event_type === "deleted") setPayload((current) => current ? { ...current, entries: current.entries.filter((entry) => entry.id !== event.entry_id), totalCount: Math.max(0, current.totalCount - 1) } : current);
        else {
          const entryResponse = await fetch(`/api/share/${encodeURIComponent(token)}/entries/${event.entry_id}`, { cache: "no-store" });
          const entryResult = await entryResponse.json();
          if (entryResponse.ok && entryResult.entry && !entryResult.entry.is_deleted) setPayload((current) => current ? { ...current, entries: current.entries.some((entry) => entry.id === event.entry_id) ? current.entries.map((entry) => entry.id === event.entry_id ? entryResult.entry : entry) : [...current.entries, entryResult.entry].sort((a, b) => a.sort_key - b.sort_key), totalCount: event.event_type === "inserted" ? current.totalCount + 1 : current.totalCount } : current);
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 2500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [load, payload, token]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/share/${encodeURIComponent(token)}/auth`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nickname: form.get("nickname"), password: form.get("password"), passwordConfirm: form.get("passwordConfirm") }) });
    const result = await response.json(); setPending(false);
    if (!response.ok) return setError(result.error ?? "Guest 로그인에 실패했습니다.");
    await load();
  }
  async function signOut() { await fetch(`/api/share/${encodeURIComponent(token)}/auth`, { method: "DELETE" }); setPayload(null); setAuthRequired(true); }
  async function saveTitle() { if (!payload?.canEdit) return; const response = await fetch(`/api/share/${encodeURIComponent(token)}/page`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: payload.page.title }) }); if (!response.ok) window.alert("제목을 저장하지 못했습니다."); }
  async function edit(entry: LogEntry) {
    if (!payload?.canEdit) return;
    let body: Record<string, unknown>;
    if (entry.document_version === 2 && entry.document) {
      const segments = editableTextSegments(entry.document); const contentEdits = segments.map((segment) => ({ id: segment.id, text: window.prompt("메시지 내용", segment.text) ?? segment.text }));
      body = { contentEdits, expectedUpdatedAt: entry.updated_at };
    } else { const content = window.prompt("메시지 내용", entry.content); if (content == null) return; body = { content, expectedUpdatedAt: entry.updated_at }; }
    setPending(true); const response = await fetch(`/api/share/${encodeURIComponent(token)}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); setPending(false); if (!response.ok) return window.alert(result.error ?? "메시지를 저장하지 못했습니다."); setPayload((current) => current ? { ...current, entries: current.entries.map((item) => item.id === entry.id ? result.entry : item) } : current);
  }
  async function editCss(entry: LogEntry) {
    if (!payload?.canEdit || !entry.document) return; const targets = styledContentTargets(entry.document); if (!targets.length) return window.alert("수정할 Content CSS가 없습니다.");
    const styleEdits = targets.map((target) => ({ id: target.id, css: window.prompt(`${target.label} CSS`, styleToEditorText(target.style)) ?? styleToEditorText(target.style) }));
    setPending(true); const response = await fetch(`/api/share/${encodeURIComponent(token)}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ styleEdits, expectedUpdatedAt: entry.updated_at }) }); const result = await response.json(); setPending(false); if (!response.ok) return window.alert(result.error ?? "CSS를 저장하지 못했습니다."); setPayload((current) => current ? { ...current, entries: current.entries.map((item) => item.id === entry.id ? result.entry : item) } : current);
  }
  async function remove(entry: LogEntry) { if (!window.confirm("이 메시지를 삭제할까요?")) return; const response = await fetch(`/api/share/${encodeURIComponent(token)}/entries/${entry.id}`, { method: "DELETE" }); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "삭제하지 못했습니다."); setPayload((current) => current ? { ...current, entries: current.entries.filter((item) => item.id !== entry.id), totalCount: Math.max(0, current.totalCount - 1) } : current); }
  async function showTrash() { const response = await fetch(`/api/share/${encodeURIComponent(token)}/trash`); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "삭제 메시지를 불러오지 못했습니다."); setTrash(result.entries ?? []); }
  async function restore(entry: LogEntry) { const response = await fetch(`/api/share/${encodeURIComponent(token)}/trash`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryId: entry.id }) }); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "복원하지 못했습니다."); setTrash((current) => current?.filter((item) => item.id !== entry.id) ?? null); setPayload((current) => current ? { ...current, entries: [...current.entries, result.entry].sort((a, b) => a.sort_key - b.sort_key), totalCount: current.totalCount + 1 } : current); }
  async function loadMore() { if (!payload?.entries.length) return; setPending(true); const response = await fetch(`/api/share/${encodeURIComponent(token)}/log?after=${payload.entries.at(-1)?.sort_key}`); const result = await response.json(); setPending(false); if (response.ok) setPayload((current) => current ? { ...current, entries: [...current.entries, ...(result.entries ?? [])] } : current); }

  if (loading) return <main className="public-log"><p>로그 불러오는 중…</p></main>;
  if (authRequired) return <main className="guest-auth"><form className="modal-card" onSubmit={authenticate}><h1>Guest 참여</h1><p>처음이라면 비밀번호 확인까지 입력하세요. 다시 방문했다면 닉네임과 비밀번호만 입력하면 됩니다.</p><label className="field">닉네임<input name="nickname" minLength={2} maxLength={40} required disabled={pending} /></label><label className="field">비밀번호<input name="password" type="password" minLength={4} required disabled={pending} /></label><label className="field">비밀번호 확인 (처음 참여할 때)<input name="passwordConfirm" type="password" minLength={4} disabled={pending} /></label>{error && <p className="error">{error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "확인 중…" : "참여하기"}</button></form></main>;
  if (!payload) return <main className="public-log"><p className="error">{error || "Guest 링크를 사용할 수 없습니다."}</p></main>;
  return <main className="public-log guest-log"><div className="workspace-toolbar"><span>{payload.participant.nickname} · 손님 {payload.canEdit ? "편집자" : "뷰어"}</span><div className="toolbar-actions"><button className="button" onClick={() => setExportOpen(true)}><Download size={14} /> TXT</button>{payload.canEdit && <button className="button" onClick={showTrash}><Trash2 size={14} /> 삭제 메시지</button>}<button className="button" onClick={signOut}><LogOut size={14} /> 나가기</button></div></div><input className="page-title-input" value={payload.page.title} readOnly={!payload.canEdit} onChange={(event) => setPayload({ ...payload, page: { ...payload.page, title: event.target.value } })} onBlur={saveTitle} /><p className="page-meta">{payload.totalCount.toLocaleString()}개 메시지 · {payload.canEdit ? "편집 가능" : "읽기 전용"}</p><section>{payload.entries.map((entry) => <div className="entry-wrap" key={entry.id}><LogEntryBlock entry={entry} />{payload.canEdit && <div className="guest-entry-actions"><button className="button" onClick={() => edit(entry)} disabled={pending}><Pencil size={13} /> 수정</button>{entry.document && <button className="button" onClick={() => editCss(entry)} disabled={pending}>CSS</button>}<button className="button button-danger" onClick={() => remove(entry)} disabled={pending}><Trash2 size={13} /> 삭제</button></div>}</div>)}</section>{payload.entries.length < payload.totalCount && <button className="button load-more-entries" onClick={loadMore} disabled={pending}>{pending ? "불러오는 중…" : "다음 메시지 50개 불러오기"}</button>}{trash && <div className="modal-backdrop" onMouseDown={() => setTrash(null)}><section className="modal-card" onMouseDown={(event) => event.stopPropagation()}><h2>삭제 메시지</h2>{trash.map((entry) => <div className="trash-item" key={entry.id}><span>{entry.content.slice(0, 100)}</span><button className="button" onClick={() => restore(entry)}><RotateCcw size={13} /> 복원</button></div>)}<button className="button" onClick={() => setTrash(null)}>닫기</button></section></div>}{exportOpen && <ExportDialog endpoint={`/api/share/${encodeURIComponent(token)}/export`} title={payload.page.title} usePersonalDefaults={false} onClose={() => setExportOpen(false)} />}</main>;
}
