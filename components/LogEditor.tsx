"use client";

import { FormEvent, useEffect, useState } from "react";
import { Archive, Download, History, RotateCcw, Settings2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { LogEntry, LogEntryRevision, Publication, WorkspacePage } from "@/lib/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { CorrectionSettings } from "@/lib/logs/corrections";
import { Roll20V2Renderer } from "@/components/logs/Roll20V2Renderer";
import { InlineContentEditor } from "@/components/logs/InlineContentEditor";
import { EntryContextMenu } from "@/components/logs/EntryContextMenu";
import { cloneLogDocument, styleToEditorText } from "@/lib/logs/model/editor";
import { contentStyleMap, editableTextSegments, styledContentTargets } from "@/lib/logs/model/user-edit";
import type { LogEntryDocument } from "@/lib/logs/model/types";

export type ImportSummary = {
  provider?: string;
  sourceMessageCount?: number;
  importedMessageCount?: number;
  hiddenMessageCount?: number;
  duplicateMessageCount?: number;
  logicalMessageCount?: number;
  structuralDuplicateCount?: number;
  errorDuplicateCount?: number;
  hiddenRemovedCount?: number;
  warningCount?: number;
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
        <div className="page-meta">{entries.length.toLocaleString()}개 메시지 블록{summary?.provider === "roll20" && <> · 원본 {summary.sourceMessageCount ?? 0}개 · 논리 메시지 {summary.logicalMessageCount ?? summary.importedMessageCount ?? 0}개 · 구조 반복 {summary.structuralDuplicateCount ?? 0}개 정규화 · hidden {summary.hiddenRemovedCount ?? summary.hiddenMessageCount ?? 0}개 제거 · 오류 중복 {summary.errorDuplicateCount ?? summary.duplicateMessageCount ?? 0}개 제거{Boolean(summary.warningCount) && <> · 경고 {summary.warningCount}개</>}</>}</div>
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
  return <div className="trash-control"><button className="button" onClick={toggle}><History size={14} /> 원본 백업</button>{open && <div className="trash-panel import-history-panel">{imports.length ? imports.map((item) => <div className="trash-item" key={item.id}><span><strong>{new Date(item.created_at).toLocaleString("ko-KR")}</strong><small>원본 {item.report?.sourceMessageCount ?? 0}개 · 논리 메시지 {item.report?.logicalMessageCount ?? item.report?.importedMessageCount ?? 0}개 · 오류 중복 제거 {item.report?.errorDuplicateCount ?? item.report?.duplicateMessageCount ?? 0}개</small></span><a className="button" href={`/api/pages/${pageId}/imports/${item.id}`}>HTML 다운로드</a></div>) : <p>저장된 원본이 없습니다.</p>}</div>}</div>;
}

function EditableEntry({ pageId, entry }: { pageId: string; entry: LogEntry }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(entry.content);
  const [document, setDocument] = useState<LogEntryDocument | null>(entry.document ? cloneLogDocument(entry.document) : null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showCss, setShowCss] = useState(false);
  const [cssDrafts, setCssDrafts] = useState<Array<{ id: string; label: string; css: string }>>([]);
  const [revisions, setRevisions] = useState<LogEntryRevision[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [editingVersion, setEditingVersion] = useState(entry.updated_at);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setContent(entry.content);
    setDocument(entry.document ? cloneLogDocument(entry.document) : null);
  }, [editing, entry.content, entry.document]);

  function startEditing() {
    setContent(entry.content);
    setDocument(entry.document ? cloneLogDocument(entry.document) : null);
    setEditingVersion(entry.updated_at);
    setEditing(true);
  }

  async function save() {
    let body: Record<string, unknown>;
    if (entry.document_version === 2 && document && entry.document) {
      const before = new Map(editableTextSegments(entry.document).map((segment) => [segment.id, segment.text]));
      const contentEdits = editableTextSegments(document).filter((segment) => before.get(segment.id) !== segment.text);
      if (!contentEdits.length) { setEditing(false); return; }
      body = { contentEdits, expectedUpdatedAt: editingVersion };
    } else body = { content, expectedUpdatedAt: editingVersion };
    setSaving(true);
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!response.ok) { const result = await response.json(); return window.alert(result.error ?? "블록을 저장하지 못했습니다."); }
    setEditing(false);
    router.refresh();
  }

  function cancelEditing() {
    setContent(entry.content);
    setDocument(entry.document ? cloneLogDocument(entry.document) : null);
    setEditing(false);
  }

  async function remove() {
    if (!window.confirm("이 블록을 휴지통으로 이동할까요?")) return;
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "DELETE" });
    if (!response.ok) return window.alert("블록을 삭제하지 못했습니다.");
    router.refresh();
  }

  async function loadHistory() {
    setShowHistory(true);
    setLoadingHistory(true);
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`);
    const result = await response.json();
    setLoadingHistory(false);
    if (!response.ok) return window.alert(result.error ?? "수정 이력을 불러오지 못했습니다.");
    setRevisions(result.revisions ?? []);
  }

  async function revert(revision: LogEntryRevision) {
    if (!window.confirm("이 수정 이전 상태로 복원할까요? 현재 상태도 새 revision으로 기록됩니다.")) return;
    const body = entry.document_version === 2 ? { revisionId: revision.id, expectedUpdatedAt: entry.updated_at } : { content: revision.previous_content, revisionAction: "revert", expectedUpdatedAt: entry.updated_at };
    if (entry.document_version === 2 && !revision.previous_snapshot) return window.alert("복원할 문서 snapshot이 없습니다.");
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) return window.alert("이 버전으로 복원하지 못했습니다.");
    setContent(revision.previous_content);
    if (revision.previous_snapshot) setDocument(cloneLogDocument(revision.previous_snapshot));
    setShowHistory(false);
    router.refresh();
  }

  function openCssEditor() {
    if (entry.original_document?.source.platform !== "roll20" || !entry.document) return;
    const currentStyles = contentStyleMap(entry.document);
    setCssDrafts(styledContentTargets(entry.original_document).map((target) => ({ id: target.id, label: target.label, css: styleToEditorText(currentStyles.get(target.id) ?? target.style) })));
    setShowCss(true);
  }

  async function saveCss() {
    setSaving(true);
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ styleEdits: cssDrafts.map(({ id, css }) => ({ id, css })), expectedUpdatedAt: entry.updated_at }) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return window.alert(result.error ?? "CSS를 저장하지 못했습니다.");
    setShowCss(false);
    if (result.styleWarnings?.length) window.alert("허용되지 않거나 잘못된 CSS 선언은 제외하고 저장했습니다.");
    router.refresh();
  }

  async function restoreOriginal() {
    if (!window.confirm("이 메시지를 최초 Roll20 import 상태로 복원할까요? 현재 상태도 수정 이력에 남습니다.")) return;
    setSaving(true);
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ restoreOriginal: true, expectedUpdatedAt: entry.updated_at }) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return window.alert(result.error ?? "원본 상태로 복원하지 못했습니다.");
    router.refresh();
  }

  if (editing && entry.document_version === 2 && document) return <InlineContentEditor document={document} saving={saving} onChange={setDocument} onSave={save} onCancel={cancelEditing} />;
  if (editing) return <article className="log-entry"><label className="field">{entry.speaker_name ?? "내용"}<textarea value={content} onChange={(event) => setContent(event.target.value)} autoFocus /></label><button className="button button-primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button> <button className="button" onClick={cancelEditing} disabled={saving}>취소</button></article>;

  const hasRoll20Original = entry.original_document?.source.platform === "roll20";
  const canEditCss = Boolean(entry.document && hasRoll20Original && entry.original_document && styledContentTargets(entry.original_document).length);
  return <div className="entry-wrap">
    <article className={`log-entry entry-${entry.entry_type} ${entry.document_version === 2 ? "log-entry-v2" : ""}`} onDoubleClick={startEditing} onContextMenu={(event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); }} title="더블클릭: 내용 수정 · 우클릭: 부가 기능">
      {entry.document_version === 2 && entry.document ? <Roll20V2Renderer document={entry.document} /> : entry.raw_html ? <div className="preserved-roll20-entry" dangerouslySetInnerHTML={{ __html: entry.raw_html }} /> : <>{entry.speaker_name && <div className="log-entry-speaker" style={{ color: entry.speaker_color ?? undefined }}>{entry.speaker_name}</div>}<div className="log-entry-content">{entry.content}</div></>}
    </article>
    {menu && <EntryContextMenu x={menu.x} y={menu.y} canEditCss={canEditCss} canRestoreOriginal={Boolean(entry.document_version === 2 && hasRoll20Original)} onEditCss={openCssEditor} onHistory={loadHistory} onRestoreOriginal={restoreOriginal} onDelete={remove} onClose={() => setMenu(null)} />}
    {showCss && <div className="modal-backdrop" onMouseDown={() => setShowCss(false)}><section className="modal-card content-css-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowCss(false)}><X size={17} /></button><h2>CSS 수정</h2><p>Roll20 원본 Content CSS만 수정합니다. 허용되지 않은 선언은 저장할 때 안전하게 제외됩니다.</p><div className="content-css-list">{cssDrafts.map((target, index) => <label key={target.id}><strong>{target.label}</strong><textarea value={target.css} onChange={(event) => setCssDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, css: event.target.value } : item))} spellCheck={false} /></label>)}</div><div className="modal-actions"><button className="button" onClick={() => setShowCss(false)} disabled={saving}>취소</button><button className="button button-primary" onClick={saveCss} disabled={saving}>{saving ? "적용 중…" : "적용"}</button></div></section></div>}
    {showHistory && <div className="modal-backdrop" onMouseDown={() => setShowHistory(false)}><section className="modal-card entry-history-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowHistory(false)}><X size={17} /></button><h2>수정 이력</h2>{loadingHistory ? <p>불러오는 중…</p> : revisions.length ? <div className="history-panel">{revisions.map((revision) => <div className="history-item" key={revision.id}><div><span>{revision.action === "edit" ? "수정" : revision.action === "revert" ? "이력 복원" : revision.action === "restore" ? "복원" : "삭제"}</span><time>{new Date(revision.created_at).toLocaleString("ko-KR")}</time></div><p>{revision.previous_content || "(빈 내용)"}</p>{(entry.document_version !== 2 || Boolean(revision.previous_snapshot)) && <button className="button" onClick={() => revert(revision)}><RotateCcw size={13} /> 이 상태로 복원</button>}</div>)}</div> : <p>아직 수정 이력이 없습니다.</p>}</section></div>}
  </div>;
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
