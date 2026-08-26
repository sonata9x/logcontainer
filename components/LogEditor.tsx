"use client";

import { FormEvent, useEffect, useState } from "react";
import { Archive, Download, History, Plus, RotateCcw, Settings2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { LogEntry, LogEntryRevision, Publication, WorkspacePage } from "@/lib/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { CorrectionSettings } from "@/lib/logs/corrections";

export type ImportSummary = {
  provider?: string;
  sourceMessageCount?: number;
  importedMessageCount?: number;
  hiddenMessageCount?: number;
  duplicateMessageCount?: number;
};
type ImportSnapshot = { id: string; created_at: string; report: ImportSummary | null };

export function LogEditor({ page, logId, entries, publication, importReport }: { page: WorkspacePage; logId: string; entries: LogEntry[]; publication: Publication | null; importReport: ImportSummary | null }) {
  const router = useRouter();
  const [title, setTitle] = useState(page.title);
  const [source, setSource] = useState("");
  const [showImport, setShowImport] = useState(entries.length === 0);
  const [pending, setPending] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(importReport);
  const [removeHiddenMessages, setRemoveHiddenMessages] = useState(false);
  const [removeDuplicateMessages, setRemoveDuplicateMessages] = useState(false);
  const [copied, setCopied] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(`log-${logId}`).on("postgres_changes", { event: "*", schema: "public", table: "log_entries", filter: `log_id=eq.${logId}` }, () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => router.refresh(), 180);
    }).subscribe((status) => setLiveConnected(status === "SUBSCRIBED"));
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [logId, router]);

  async function saveTitle() {
    if (title.trim() === page.title) return;
    await fetch(`/api/pages/${page.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    router.refresh();
  }

  async function importLog(event: FormEvent) {
    event.preventDefault();
    if (!source.trim()) return;
    if (entries.length && !window.confirm("현재 편집 블록을 새 Roll20 로그로 교체할까요? 기존 원본은 가져오기 이력에 보존됩니다.")) return;
    setPending(true);
    const response = await fetch(`/api/pages/${page.id}/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, removeHiddenMessages, removeDuplicateMessages }) });
    const result = await response.json();
    setPending(false);
    if (!response.ok) return window.alert(result.error ?? "로그를 가져오지 못했습니다.");
    setSource("");
    setSummary(result.report ?? null);
    setShowImport(false);
    router.refresh();
  }

  async function togglePublish() {
    setPending(true);
    const response = await fetch(`/api/pages/${page.id}/publication`, { method: publication?.is_active ? "DELETE" : "POST" });
    const result = await response.json();
    setPending(false);
    if (!response.ok) return window.alert(result.error ?? "게시 상태를 변경하지 못했습니다.");
    router.refresh();
  }

  async function archivePage() {
    if (!window.confirm("이 로그 페이지를 보관할까요? 게시 중인 링크도 더 이상 열리지 않습니다.")) return;
    const response = await fetch(`/api/pages/${page.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isArchived: true }) });
    if (!response.ok) return window.alert("페이지를 보관하지 못했습니다.");
    router.push("/workspace");
    router.refresh();
  }

  const publicUrl = publication?.is_active ? `/p/${publication.token}` : null;

  async function copyPublicUrl() {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(`${window.location.origin}${publicUrl}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <>
      <div className="workspace-toolbar"><span className="live-status"><i className={liveConnected ? "connected" : ""} />로그 · {liveConnected ? "공동 편집 연결됨" : "연결 중"}</span><div className="toolbar-actions"><button className="button" onClick={archivePage} title="보관"><Archive size={14} /></button><button className="button" onClick={togglePublish} disabled={pending}>{publication?.is_active ? "게시 중단" : "게시하기"}</button></div></div>
      <div className="workspace-content">
        <input className="page-title-input" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} aria-label="로그 제목" />
        <div className="page-meta">{entries.length.toLocaleString()}개 메시지 블록{summary?.provider === "roll20" && <> · 원본 {summary.sourceMessageCount ?? 0}개 · hidden {summary.hiddenMessageCount ?? 0}개 제거 · 중복 ID {summary.duplicateMessageCount ?? 0}개 제거</>}</div>
        <div className="editor-actions"><button className="button" onClick={() => setShowImport((value) => !value)}>HTML 가져오기</button><ImportHistoryPanel pageId={page.id} /><CorrectionPanel pageId={page.id} /><a className="button icon-button" href={`/api/pages/${page.id}/export`}><Download size={14} /> TXT 내보내기</a><TrashPanel pageId={page.id} /></div>
        {publication?.is_active && <div className="publish-popover"><strong>이 로그만 게시 중입니다.</strong>{publicUrl && <div className="publish-link-row"><a className="publish-url" href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a><button className="button" onClick={copyPublicUrl}>{copied ? "복사됨" : "링크 복사"}</button></div>}<small>공개 화면에는 사이드바와 다른 페이지 링크가 나타나지 않습니다.</small></div>}
        {showImport && <form onSubmit={importLog}><label className="field">Roll20 백업 HTML 또는 복사한 Roll20 로그 HTML<textarea value={source} onChange={(event) => setSource(event.target.value)} placeholder="Roll20 HTML을 붙여넣으세요. 기존 블록이 있으면 교체됩니다." required /></label><div className="import-options"><label><input type="checkbox" checked={removeHiddenMessages} onChange={(event) => setRemoveHiddenMessages(event.target.checked)} /> hidden message 삭제</label><label><input type="checkbox" checked={removeDuplicateMessages} onChange={(event) => setRemoveDuplicateMessages(event.target.checked)} /> 중복 message 삭제</label></div><button className="button button-primary" disabled={pending}>{pending ? "가져오는 중…" : "가져오기"}</button></form>}
        <section>{entries.map((entry) => <EditableEntry key={entry.id} pageId={page.id} entry={entry} />)}</section>
      </div>
    </>
  );
}

function CorrectionPanel({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<CorrectionSettings | null>(null);
  const [saving, setSaving] = useState(false);
  async function show() {
    setOpen(true);
    const response = await fetch(`/api/pages/${pageId}/corrections`);
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "교정 설정을 불러오지 못했습니다.");
    setSettings(result.settings);
  }
  async function save() {
    if (!settings) return;
    setSaving(true);
    const response = await fetch(`/api/pages/${pageId}/corrections`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
    setSaving(false);
    if (!response.ok) return window.alert("교정 설정을 저장하지 못했습니다.");
    setOpen(false);
  }
  function setBoolean(key: keyof CorrectionSettings, value: boolean) { setSettings((current) => current ? { ...current, [key]: value } : current); }
  function setText(key: keyof CorrectionSettings, value: string) { setSettings((current) => current ? { ...current, [key]: value } : current); }
  const toggles: Array<[keyof CorrectionSettings, string]> = [["normalize_ellipsis", "말줄임표 통일"], ["normalize_quotes", "큰따옴표 통일"], ["speaker_tab_format", "화자명 뒤에 탭"], ["clean_blank_lines", "빈 줄 정리"], ["mark_handout_position", "이미지·핸드아웃 위치 표시"]];
  return <><button className="button icon-button" onClick={show}><Settings2 size={14} /> 교정 설정</button>{open && <div className="modal-backdrop" onMouseDown={() => setOpen(false)}><section className="modal-card correction-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setOpen(false)}><X size={17} /></button><h2>TXT 교정 설정</h2><p>이 설정은 로그 원문을 바꾸지 않고 TXT 다운로드 순간에만 적용됩니다.</p>{settings ? <><div className="correction-toggles">{toggles.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setBoolean(key, event.target.checked)} /> {label}</label>)}</div><div className="correction-symbols"><label>여는 따옴표<input value={settings.custom_quote_open} onChange={(event) => setText("custom_quote_open", event.target.value)} /></label><label>닫는 따옴표<input value={settings.custom_quote_close} onChange={(event) => setText("custom_quote_close", event.target.value)} /></label><label>말줄임표<input value={settings.custom_ellipsis} onChange={(event) => setText("custom_ellipsis", event.target.value)} /></label><label>핸드아웃 기호<input value={settings.custom_handout_icon} onChange={(event) => setText("custom_handout_icon", event.target.value)} /></label></div><button className="button button-primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "설정 저장"}</button></> : <p>불러오는 중…</p>}</section></div>}</>;
}

function ImportHistoryPanel({ pageId }: { pageId: string }) {
  const [open, setOpen] = useState(false);
  const [imports, setImports] = useState<ImportSnapshot[]>([]);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const response = await fetch(`/api/pages/${pageId}/imports`);
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "가져오기 이력을 불러오지 못했습니다.");
    setImports(result.imports ?? []);
  }
  return <div className="trash-control"><button className="button" onClick={toggle}><History size={14} /> 원본 백업</button>{open && <div className="trash-panel import-history-panel">{imports.length ? imports.map((item) => <div className="trash-item" key={item.id}><span><strong>{new Date(item.created_at).toLocaleString("ko-KR")}</strong><small>메시지 {item.report?.sourceMessageCount ?? 0}개 · 중복 제거 {item.report?.duplicateMessageCount ?? 0}개</small></span><a className="button" href={`/api/pages/${pageId}/imports/${item.id}`}>HTML 다운로드</a></div>) : <p>저장된 원본이 없습니다.</p>}</div>}</div>;
}

function EditableEntry({ pageId, entry }: { pageId: string; entry: LogEntry }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(entry.content);
  const [adding, setAdding] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<LogEntryRevision[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [editingVersion, setEditingVersion] = useState(entry.updated_at);

  function startEditing() {
    setContent(entry.content);
    setEditingVersion(entry.updated_at);
    setEditing(true);
  }

  async function save() {
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content, expectedUpdatedAt: editingVersion }) });
    if (!response.ok) { const result = await response.json(); return window.alert(result.error ?? "블록을 저장하지 못했습니다."); }
    setEditing(false);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm("이 블록을 휴지통으로 이동할까요?")) return;
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "DELETE" });
    if (!response.ok) return window.alert("블록을 삭제하지 못했습니다.");
    router.refresh();
  }

  async function loadHistory() {
    const next = !showHistory;
    setShowHistory(next);
    if (!next) return;
    setLoadingHistory(true);
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`);
    const result = await response.json();
    setLoadingHistory(false);
    if (!response.ok) return window.alert(result.error ?? "수정 이력을 불러오지 못했습니다.");
    setRevisions(result.revisions ?? []);
  }

  async function revert(revision: LogEntryRevision) {
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: revision.previous_content, revisionAction: "revert", expectedUpdatedAt: entry.updated_at }) });
    if (!response.ok) return window.alert("이 버전으로 복원하지 못했습니다.");
    setContent(revision.previous_content);
    setShowHistory(false);
    router.refresh();
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const response = await fetch(`/api/pages/${pageId}/entries`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ afterEntryId: entry.id, entryType: data.get("entryType"), speakerName: data.get("speakerName"), content: data.get("content") }) });
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "블록을 추가하지 못했습니다.");
    setAdding(false);
    router.refresh();
  }

  if (editing) return <article className="log-entry"><label className="field">{entry.speaker_name ?? "내용"}<textarea value={content} onChange={(event) => setContent(event.target.value)} autoFocus /></label><button className="button button-primary" onClick={save}>저장</button> <button className="button" onClick={() => { setContent(entry.content); setEditing(false); }}>취소</button></article>;

  return <div className="entry-wrap"><article className={`log-entry entry-${entry.entry_type}`} onDoubleClick={startEditing} title="더블클릭하여 수정">{entry.raw_html ? <div className="preserved-roll20-entry" dangerouslySetInnerHTML={{ __html: entry.raw_html }} /> : <>{entry.speaker_name && <div className="log-entry-speaker" style={{ color: entry.speaker_color ?? undefined }}>{entry.speaker_name}</div>}<div className="log-entry-content">{entry.content}</div></>}<div className="entry-controls"><button onClick={() => setAdding((value) => !value)} title="아래에 추가"><Plus size={14} /></button><button onClick={loadHistory} title="수정 이력"><History size={14} /></button><button onClick={remove} title="휴지통으로 이동"><Trash2 size={14} /></button></div></article>{adding && <form className="inline-add-form" onSubmit={add}><div className="inline-add-row"><select name="entryType"><option value="dialogue">대화</option><option value="system">지문</option></select><input name="speakerName" placeholder="화자명(선택)" /><input name="content" placeholder="새 블록 내용" required /><button className="button button-primary">추가</button></div></form>}{showHistory && <div className="history-panel"><strong>수정 이력</strong>{loadingHistory ? <p>불러오는 중…</p> : revisions.length ? revisions.map((revision) => <div className="history-item" key={revision.id}><div><span>{revision.action}</span><time>{new Date(revision.created_at).toLocaleString("ko-KR")}</time></div><p>{revision.previous_content || "(빈 내용)"}</p>{revision.action !== "delete" && revision.action !== "restore" && <button className="button" onClick={() => revert(revision)}><RotateCcw size={13} /> 이 내용으로 복원</button>}</div>) : <p>아직 수정 이력이 없습니다.</p>}</div>}</div>;
}

function TrashPanel({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const response = await fetch(`/api/pages/${pageId}/trash`);
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "휴지통을 불러오지 못했습니다.");
    setEntries(result.entries ?? []);
  }
  async function restore(entryId: string) {
    const response = await fetch(`/api/pages/${pageId}/trash`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entryId }) });
    if (!response.ok) return window.alert("블록을 복원하지 못했습니다.");
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    router.refresh();
  }
  return <div className="trash-control"><button className="button" onClick={toggle}><Trash2 size={14} /> 휴지통</button>{open && <div className="trash-panel">{entries.length ? entries.map((entry) => <div className="trash-item" key={entry.id}><span>{entry.speaker_name ? `${entry.speaker_name}: ` : ""}{entry.content.slice(0, 80)}</span><button className="button" onClick={() => restore(entry.id)}>복원</button></div>) : <p>휴지통이 비어 있습니다.</p>}</div>}</div>;
}
