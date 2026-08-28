"use client";

import { FormEvent, memo, useCallback, useEffect, useRef, useState } from "react";
import { Archive, Download, History, Info, MoreHorizontal, RotateCcw, Share2, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { Upload } from "tus-js-client";
import type { LogEntry, LogEntryRevision, Publication, ResourcePermissions, WorkspacePage } from "@/lib/types";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { Roll20V2Renderer } from "@/components/logs/Roll20V2Renderer";
import { InlineContentEditor } from "@/components/logs/InlineContentEditor";
import { EntryContextMenu } from "@/components/logs/EntryContextMenu";
import { cloneLogDocument } from "@/lib/logs/model/editor";
import { editableTextSegments, hasStyledContent } from "@/lib/logs/model/user-edit";
import type { LogEntryDocument } from "@/lib/logs/model/types";
import { MAX_STAGED_ROLL20_SOURCE_SIZE, SUPABASE_TUS_CHUNK_SIZE } from "@/lib/logs/import-limits";
import { ShareDialog } from "@/components/WorkspaceSidebar";
import { ExportDialog } from "@/components/ExportDialog";

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

type ImportUploadTarget = {
  uploadId: string;
  storagePath: string;
  storageOrigin: string;
  bucket: string;
};

function uploadRoll20File(file: File, target: ImportUploadTarget, accessToken: string, onProgress: (percentage: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `${target.storageOrigin}/storage/v1/upload/resumable`,
      headers: { authorization: `Bearer ${accessToken}` },
      metadata: {
        bucketName: target.bucket,
        objectName: target.storagePath,
        contentType: "text/html",
        cacheControl: "0"
      },
      chunkSize: SUPABASE_TUS_CHUNK_SIZE,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      onProgress(bytesSent, bytesTotal) {
        onProgress(bytesTotal ? Math.round((bytesSent / bytesTotal) * 100) : 0);
      },
      onError(error) { reject(error); },
      onSuccess() { resolve(); }
    });
    upload.start();
  });
}

export function LogEditor({ page, permissions, logId, entries, totalEntryCount, publication, importReport }: { page: WorkspacePage; permissions: ResourcePermissions; logId: string; entries: LogEntry[]; totalEntryCount: number; publication: Publication | null; importReport: ImportSummary | null }) {
  const router = useRouter();
  const [liveEntries, setLiveEntries] = useState(entries);
  const [totalCount, setTotalCount] = useState(totalEntryCount);
  const totalCountRef = useRef(totalEntryCount);
  const visibilityEvents = useRef(new Set<string>());
  const [activePublication, setActivePublication] = useState(publication);
  const [title, setTitle] = useState(page.title);
  const [source, setSource] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [showImport, setShowImport] = useState(Boolean(page.is_original_owner) && totalEntryCount === 0);
  const [pending, setPending] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [summary, setSummary] = useState<ImportSummary | null>(importReport);
  const [removeHiddenMessages, setRemoveHiddenMessages] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [publicationOpen, setPublicationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const loadingMoreRef = useRef(false);
  const loadMoreSentinel = useRef<HTMLDivElement>(null);
  const importFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { totalCountRef.current = totalCount; }, [totalCount]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const loadFirstPage = async () => {
      const response = await fetch(`/api/pages/${page.id}/entries`);
      const result = await response.json();
      if (response.ok) {
        setLiveEntries(result.entries ?? []);
        if (typeof result.totalCount === "number") setTotalCount(result.totalCount);
      }
    };
    const channel = supabase.channel(`log-${logId}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "log_change_events", filter: `log_id=eq.${logId}` }, async (payload) => {
      const change = payload.new as { entry_id?: string | null; event_type?: string };
      if (change.event_type === "log_replaced") { visibilityEvents.current.clear(); await loadFirstPage(); return; }
      if (!change.entry_id) return;
      if (change.event_type === "deleted") {
        const key = `deleted:${change.entry_id}`;
        visibilityEvents.current.delete(`restored:${change.entry_id}`);
        if (!visibilityEvents.current.has(key)) {
          visibilityEvents.current.add(key);
          setTotalCount((count) => Math.max(0, count - 1));
        }
        setLiveEntries((current) => current.filter((entry) => entry.id !== change.entry_id));
        return;
      }
      const response = await fetch(`/api/pages/${page.id}/entries/${change.entry_id}?view=entry`);
      const result = await response.json();
      if (!response.ok || !result.entry || result.entry.is_deleted) return;
      setLiveEntries((current) => {
        const existed = current.some((entry) => entry.id === result.entry.id);
        if (!existed && (change.event_type === "inserted" || change.event_type === "restored")) {
          const key = `${change.event_type}:${result.entry.id}`;
          if (change.event_type === "restored") visibilityEvents.current.delete(`deleted:${result.entry.id}`);
          if (!visibilityEvents.current.has(key)) {
            visibilityEvents.current.add(key);
            setTotalCount((count) => count + 1);
          }
        }
        const lastLoadedKey = current.at(-1)?.sort_key ?? Number.POSITIVE_INFINITY;
        if (!existed && current.length < totalCountRef.current && result.entry.sort_key > lastLoadedKey) return current;
        return [...current.filter((entry) => entry.id !== result.entry.id), result.entry].sort((left, right) => left.sort_key - right.sort_key);
      });
    }).subscribe((status) => setLiveConnected(status === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [logId, page.id]);

  const updateEntry = useCallback((next: LogEntry) => {
    setLiveEntries((current) => [...current.filter((entry) => entry.id !== next.id), next].sort((left, right) => left.sort_key - right.sort_key));
  }, []);

  const removeEntry = useCallback((entryId: string) => {
    const key = `deleted:${entryId}`;
    visibilityEvents.current.delete(`restored:${entryId}`);
    if (!visibilityEvents.current.has(key)) {
      visibilityEvents.current.add(key);
      setTotalCount((count) => Math.max(0, count - 1));
    }
    setLiveEntries((current) => current.filter((entry) => entry.id !== entryId));
  }, []);

  const restoreEntry = useCallback((entry: LogEntry) => {
    const key = `restored:${entry.id}`;
    visibilityEvents.current.delete(`deleted:${entry.id}`);
    if (!visibilityEvents.current.has(key)) {
      visibilityEvents.current.add(key);
      setTotalCount((count) => count + 1);
    }
    updateEntry(entry);
  }, [updateEntry]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current) return;
    const cursor = liveEntries.at(-1)?.sort_key;
    if (cursor == null) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/pages/${page.id}/entries?after=${cursor}`);
      const result = await response.json();
      if (!response.ok) return window.alert(result.error ?? "다음 메시지를 불러오지 못했습니다.");
      setLiveEntries((current) => {
        const merged = new Map(current.map((entry) => [entry.id, entry]));
        for (const entry of result.entries ?? []) merged.set(entry.id, entry);
        return [...merged.values()].sort((left, right) => left.sort_key - right.sort_key);
      });
    } catch {
      window.alert("다음 메시지를 불러오지 못했습니다.");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [liveEntries, page.id]);

  useEffect(() => {
    const target = loadMoreSentinel.current;
    if (!target || liveEntries.length >= totalCount) return;
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) void loadMore();
    }, { rootMargin: "400px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [liveEntries.length, loadMore, totalCount]);

  async function saveTitle() {
    if (title.trim() === page.title) return;
    const response = await fetch(`/api/pages/${page.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    if (!response.ok) setTitle(page.title);
  }

  async function importLog(event: FormEvent) {
    event.preventDefault();
    if (!page.is_original_owner || (!sourceFile && !source.trim())) return;
    if (sourceFile && (sourceFile.size < 1 || sourceFile.size > MAX_STAGED_ROLL20_SOURCE_SIZE)) {
      return window.alert("Roll20 HTML 파일은 최대 12MB까지 업로드할 수 있습니다.");
    }
    if (totalCount && !window.confirm("현재 편집 블록을 새 Roll20 로그로 교체할까요? 기존 원본은 가져오기 이력에 보존됩니다.")) return;
    setPending(true);
    let uploadId: string | null = null;
    let completed = false;
    try {
      let requestBody: { source?: string; uploadId?: string; removeHiddenMessages: boolean } = { source, removeHiddenMessages };
      if (sourceFile) {
        setImportStatus("안전한 업로드 주소를 준비하는 중…");
        const targetResponse = await fetch(`/api/pages/${page.id}/import/upload`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sizeBytes: sourceFile.size })
        });
        const targetResult = await targetResponse.json().catch(() => ({}));
        if (!targetResponse.ok) return window.alert(targetResult.error ?? "파일 업로드를 준비하지 못했습니다.");
        const target = targetResult as ImportUploadTarget;
        uploadId = target.uploadId;
        const { data: { session } } = await createSupabaseBrowserClient().auth.getSession();
        if (!session?.access_token) throw new Error("Supabase session is unavailable");
        setImportStatus("파일 업로드 중… 0%");
        await uploadRoll20File(sourceFile, target, session.access_token, (percentage) => setImportStatus(`파일 업로드 중… ${percentage}%`));
        setImportStatus("HTML 분석 및 저장 중…");
        requestBody = { uploadId, removeHiddenMessages };
      } else {
        setImportStatus("HTML 분석 및 저장 중…");
      }

      const response = await fetch(`/api/pages/${page.id}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) return window.alert(result.error ?? "로그를 가져오지 못했습니다.");
      completed = true;
      setSource("");
      setSourceFile(null);
      if (importFileInput.current) importFileInput.current.value = "";
      setSummary(result.report ?? null);
      setLiveEntries(result.entries ?? []);
      setTotalCount(result.count ?? result.entries?.length ?? 0);
      setShowImport(false);
    } catch {
      window.alert("로그 파일을 업로드하거나 가져오지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해주세요.");
    } finally {
      if (uploadId && !completed) {
        await fetch(`/api/pages/${page.id}/import/upload`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uploadId })
        }).catch(() => undefined);
      }
      setImportStatus("");
      setPending(false);
    }
  }

  async function archivePage() {
    const owner = Boolean(page.is_original_owner);
    if (!owner && !page.can_self_remove) return;
    if (!window.confirm(owner ? "이 로그를 30일 휴지통으로 이동할까요? 공유자와 게시 링크에서도 즉시 숨겨집니다." : "내 워크스페이스에서 제거하고 내 공유 권한을 종료할까요?")) return;
    const response = await fetch(`/api/pages/${page.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isArchived: true }) });
    if (!response.ok) return window.alert("페이지를 보관하지 못했습니다.");
    router.push("/workspace");
  }

  async function restoreOriginalLog() {
    if (!permissions.canRestoreOriginal || !window.confirm("현재 로그를 가장 최근 HTML import 직후 상태로 되돌릴까요? 현재 generation은 비공개 archive로 보관됩니다.")) return;
    setPending(true);
    const response = await fetch(`/api/pages/${page.id}/restore-original`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) { setPending(false); return window.alert(result.error ?? "로그를 원본으로 되돌리지 못했습니다."); }
    const entriesResponse = await fetch(`/api/pages/${page.id}/entries`);
    const entriesResult = await entriesResponse.json();
    setPending(false);
    if (entriesResponse.ok) { setLiveEntries(entriesResult.entries ?? []); setTotalCount(entriesResult.totalCount ?? result.restoredCount ?? 0); }
    setOverflowOpen(false);
  }

  return (
    <>
      <div className="workspace-toolbar"><span className="live-status"><i className={liveConnected ? "connected" : ""} />{liveConnected ? "공동 편집 연결됨" : "연결 중"}{!permissions.canEdit && " · 읽기 전용"}</span><div className="toolbar-actions">{permissions.canPublish && <button className="button" onClick={() => setPublicationOpen(true)} disabled={pending}>{activePublication?.is_active ? "게시 중" : "게시하기"}</button>}<div className="toolbar-overflow"><button className="button" aria-label="로그 메뉴" onClick={() => setOverflowOpen((value) => !value)}><MoreHorizontal size={16} /></button>{overflowOpen && <div className="toolbar-overflow-menu">{permissions.canManageShares && <button onClick={() => { setShareOpen(true); setOverflowOpen(false); }}><Share2 size={13} />공유하기</button>}{permissions.canReimport && <button onClick={() => { setShowImport(true); setOverflowOpen(false); }}>HTML 다시 불러오기</button>}{permissions.canRestoreOriginal && <button onClick={restoreOriginalLog} disabled={pending}>{pending ? "복원 중…" : "원본으로 되돌리기"}</button>}<button onClick={() => { setExportOpen(true); setOverflowOpen(false); }}><Download size={13} />TXT 내보내기</button><button onClick={() => { setInfoOpen(true); setOverflowOpen(false); }}><Info size={13} />로그 정보</button>{(permissions.canTrashResource || permissions.canSelfRemove) && <><hr /><button className="danger" onClick={archivePage}><Archive size={13} />{permissions.canTrashResource ? "휴지통으로 이동" : "내 워크스페이스에서 제거"}</button></>}</div>}</div></div></div>
      <div className="workspace-content">
        <input className="page-title-input" value={title} onChange={(event) => setTitle(event.target.value)} onBlur={saveTitle} aria-label="로그 제목" readOnly={!page.can_edit} />
        {showImport && permissions.canReimport && <form onSubmit={importLog} className="roll20-import-form"><button className="modal-close" type="button" onClick={() => setShowImport(false)} disabled={pending}><X size={17} /></button><label className="field">Roll20 백업 HTML 파일 (최대 12MB)<input ref={importFileInput} type="file" accept=".html,.htm,text/html" disabled={pending} onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)} /></label><div className="import-divider"><span>또는 4MB 이하 HTML 붙여넣기</span></div><label className="field">Roll20 로그 HTML<textarea value={source} onChange={(event) => setSource(event.target.value)} placeholder="작은 Roll20 HTML은 여기에 붙여넣을 수 있습니다. 기존 블록이 있으면 교체됩니다." disabled={pending} /></label><div className="import-options"><label><input type="checkbox" checked={removeHiddenMessages} onChange={(event) => setRemoveHiddenMessages(event.target.checked)} disabled={pending} /> hidden message 삭제</label><span>구조 반복과 명백한 오류 중복은 자동 정규화됩니다.</span></div>{importStatus && <p className="import-status" role="status" aria-live="polite">{importStatus}</p>}<button className="button button-primary" disabled={pending || (!sourceFile && !source.trim())}>{pending ? importStatus || "가져오는 중…" : "가져오기"}</button></form>}
        <section>{liveEntries.map((entry) => <EditableEntry key={entry.id} pageId={page.id} entry={entry} canEdit={Boolean(page.can_edit)} onChange={updateEntry} onDelete={removeEntry} />)}</section>
        {liveEntries.length < totalCount && <div className="load-more-sentinel" ref={loadMoreSentinel}><button className="button load-more-entries" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "불러오는 중…" : "다음 메시지 50개 불러오기"}</button></div>}
      </div>
      {shareOpen && <ShareDialog page={page} onClose={() => setShareOpen(false)} />}
      {infoOpen && <LogInfoDialog pageId={page.id} totalCount={totalCount} summary={summary} isOwner={permissions.role === "owner"} canEdit={permissions.canEdit} onRestore={restoreEntry} onClose={() => setInfoOpen(false)} />}
      {publicationOpen && <PublicationDialog pageId={page.id} publication={activePublication} onChange={setActivePublication} onClose={() => setPublicationOpen(false)} />}
      {exportOpen && <ExportDialog endpoint={`/api/pages/${page.id}/export`} title={title} usePersonalDefaults onClose={() => setExportOpen(false)} />}
    </>
  );
}

function LogInfoDialog({ pageId, totalCount, summary, isOwner, canEdit, onRestore, onClose }: { pageId: string; totalCount: number; summary: ImportSummary | null; isOwner: boolean; canEdit: boolean; onRestore: (entry: LogEntry) => void; onClose: () => void }) {
  const [info, setInfo] = useState<{ platform?: string; latestImportAt?: string | null } | null>(null);
  useEffect(() => { void fetch(`/api/pages/${pageId}/info`).then((response) => response.json()).then(setInfo).catch(() => setInfo({})); }, [pageId]);
  return <div className="modal-backdrop" onMouseDown={onClose}><section className="modal-card log-info-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose}><X size={17} /></button><h2>로그 정보</h2><dl className="log-info-grid"><dt>현재 총 메시지 수</dt><dd>{totalCount.toLocaleString()}</dd><dt>Platform</dt><dd>{info?.platform ?? summary?.provider ?? "불러오는 중…"}</dd><dt>최신 import 날짜</dt><dd>{info?.latestImportAt ? new Date(info.latestImportAt).toLocaleString("ko-KR") : "없음"}</dd><dt>원본 source message count</dt><dd>{summary?.sourceMessageCount ?? 0}</dd><dt>logical/imported count</dt><dd>{summary?.logicalMessageCount ?? summary?.importedMessageCount ?? 0}</dd><dt>structural duplicate count</dt><dd>{summary?.structuralDuplicateCount ?? 0}</dd><dt>error duplicate count</dt><dd>{summary?.errorDuplicateCount ?? summary?.duplicateMessageCount ?? 0}</dd><dt>hidden removed</dt><dd>{summary?.hiddenRemovedCount ?? summary?.hiddenMessageCount ?? 0}</dd><dt>warning count</dt><dd>{summary?.warningCount ?? 0}</dd></dl><div className="log-info-actions">{isOwner && <ImportHistoryPanel pageId={pageId} />}{canEdit && <TrashPanel pageId={pageId} onRestore={onRestore} />}</div></section></div>;
}

function PublicationDialog({ pageId, publication, onChange, onClose }: { pageId: string; publication: Publication | null; onChange: (publication: Publication | null) => void; onClose: () => void }) {
  const [current, setCurrent] = useState<Publication | null>(publication);
  const [visibility, setVisibility] = useState<"public" | "password">(publication?.visibility ?? "public");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void fetch(`/api/pages/${pageId}/publication`).then(async (response) => ({ response, result: await response.json() })).then(({ response, result }) => { if (!response.ok || !result?.id) return; const normalized: Publication = { id: result.id, page_id: result.pageId, token: result.token, is_active: result.isActive, visibility: result.visibility, password_version: result.passwordVersion, published_at: result.publishedAt, updated_at: result.updatedAt }; setCurrent(normalized); setVisibility(normalized.visibility ?? "public"); onChange(normalized); }); }, [onChange, pageId]);
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPending(true); setError(""); const response = await fetch(`/api/pages/${pageId}/publication`, { method: current?.is_active ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility, password, passwordConfirm }) }); const result = await response.json(); setPending(false); if (!response.ok) return setError(result.error ?? "게시 설정을 저장하지 못했습니다."); setCurrent(result); onChange(result); setPassword(""); setPasswordConfirm(""); }
  async function stop() { if (!window.confirm("게시를 중단할까요? 기존 비밀번호 세션도 모두 종료됩니다.")) return; setPending(true); const response = await fetch(`/api/pages/${pageId}/publication`, { method: "DELETE" }); const result = await response.json(); setPending(false); if (!response.ok) return setError(result.error ?? "게시를 중단하지 못했습니다."); setCurrent(result); onChange(result); }
  const publicUrl = current?.is_active ? `/p/${current.token}` : null;
  return <div className="modal-backdrop" onMouseDown={pending ? undefined : onClose}><section className="modal-card publication-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} disabled={pending}><X size={17} /></button><h2>{current?.is_active ? "게시 설정" : "게시하기"}</h2>{publicUrl && <div className="publish-link-row"><a className="publish-url" href={publicUrl} target="_blank" rel="noreferrer">{publicUrl}</a><button className="button" type="button" onClick={() => navigator.clipboard.writeText(`${window.location.origin}${publicUrl}`)}>링크 복사</button></div>}<form onSubmit={save}><fieldset disabled={pending}><legend>공개 범위</legend><label className="checkbox-row"><input type="radio" name="visibility" checked={visibility === "public"} onChange={() => setVisibility("public")} /> 전체 공개</label><label className="checkbox-row"><input type="radio" name="visibility" checked={visibility === "password"} onChange={() => setVisibility("password")} /> 비밀글</label>{visibility === "password" && <><label className="field">비밀번호<input type="password" minLength={4} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label className="field">비밀번호 확인<input type="password" minLength={4} maxLength={200} value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} required /></label></>}</fieldset>{error && <p className="error">{error}</p>}<div className="modal-actions">{current?.is_active && <button className="button button-danger" type="button" onClick={stop} disabled={pending}>게시 중단</button>}<button className="button button-primary" disabled={pending}>{pending ? "게시 중…" : current?.is_active ? "게시 설정 저장" : "게시 시작"}</button></div></form></section></div>;
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

const EditableEntry = memo(function EditableEntry({ pageId, entry, canEdit, onChange, onDelete }: { pageId: string; entry: LogEntry; canEdit: boolean; onChange: (entry: LogEntry) => void; onDelete: (entryId: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(entry.content);
  const [document, setDocument] = useState<LogEntryDocument | null>(null);
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
    setDocument(null);
  }, [editing, entry.content, entry.document]);

  function startEditing() {
    if (!canEdit) return;
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
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "블록을 저장하지 못했습니다.");
    if (result.entry) onChange(result.entry);
    setDocument(null);
    setEditing(false);
  }

  function cancelEditing() {
    setContent(entry.content);
    setDocument(null);
    setEditing(false);
  }

  async function remove() {
    if (!window.confirm("이 블록을 휴지통으로 이동할까요?")) return;
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "DELETE" });
    if (!response.ok) return window.alert("블록을 삭제하지 못했습니다.");
    onDelete(entry.id);
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
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "이 버전으로 복원하지 못했습니다.");
    if (result.entry) onChange(result.entry);
    setShowHistory(false);
  }

  async function openCssEditor() {
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}/content-styles`);
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "CSS 정보를 불러오지 못했습니다.");
    setCssDrafts(result.styles ?? []);
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
    if (result.entry) onChange(result.entry);
  }

  async function restoreOriginal() {
    if (!window.confirm("이 메시지를 최초 Roll20 import 상태로 복원할까요? 현재 상태도 수정 이력에 남습니다.")) return;
    setSaving(true);
    const response = await fetch(`/api/pages/${pageId}/entries/${entry.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ restoreOriginal: true, expectedUpdatedAt: entry.updated_at }) });
    const result = await response.json();
    setSaving(false);
    if (!response.ok) return window.alert(result.error ?? "원본 상태로 복원하지 못했습니다.");
    if (result.entry) onChange(result.entry);
  }

  if (editing && entry.document_version === 2 && document) return <InlineContentEditor document={document} saving={saving} onChange={setDocument} onSave={save} onCancel={cancelEditing} />;
  if (editing) return <article className="log-entry"><label className="field">{entry.speaker_name ?? "내용"}<textarea value={content} onChange={(event) => setContent(event.target.value)} autoFocus /></label><button className="button button-primary" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button> <button className="button" onClick={cancelEditing} disabled={saving}>취소</button></article>;

  const hasRoll20Original = entry.document?.source.platform === "roll20";
  const canEditCss = Boolean(entry.document && hasRoll20Original && hasStyledContent(entry.document));
  return <div className="entry-wrap">
    <article className={`log-entry entry-${entry.entry_type} ${entry.document_version === 2 ? "log-entry-v2" : ""}`} onDoubleClick={canEdit ? startEditing : undefined} onContextMenu={canEdit ? (event) => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }); } : undefined} title={canEdit ? "더블클릭: 내용 수정 · 우클릭: 부가 기능" : undefined}>
      {entry.document_version === 2 && entry.document ? <Roll20V2Renderer document={entry.document} /> : entry.raw_html ? <div className="preserved-roll20-entry" dangerouslySetInnerHTML={{ __html: entry.raw_html }} /> : <>{entry.speaker_name && <div className="log-entry-speaker" style={{ color: entry.speaker_color ?? undefined }}>{entry.speaker_name}</div>}<div className="log-entry-content">{entry.content}</div></>}
    </article>
    {menu && <EntryContextMenu x={menu.x} y={menu.y} canEditCss={canEditCss} canRestoreOriginal={Boolean(entry.document_version === 2 && hasRoll20Original)} onEditCss={openCssEditor} onHistory={loadHistory} onRestoreOriginal={restoreOriginal} onDelete={remove} onClose={() => setMenu(null)} />}
    {showCss && <div className="modal-backdrop" onMouseDown={() => setShowCss(false)}><section className="modal-card content-css-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowCss(false)}><X size={17} /></button><h2>CSS 수정</h2><p>Roll20 원본 Content CSS만 수정합니다. 허용되지 않은 선언은 저장할 때 안전하게 제외됩니다.</p><div className="content-css-list">{cssDrafts.map((target, index) => <label key={target.id}><strong>{target.label}</strong><textarea value={target.css} onChange={(event) => setCssDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, css: event.target.value } : item))} spellCheck={false} /></label>)}</div><div className="modal-actions"><button className="button" onClick={() => setShowCss(false)} disabled={saving}>취소</button><button className="button button-primary" onClick={saveCss} disabled={saving}>{saving ? "적용 중…" : "적용"}</button></div></section></div>}
    {showHistory && <div className="modal-backdrop" onMouseDown={() => setShowHistory(false)}><section className="modal-card entry-history-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowHistory(false)}><X size={17} /></button><h2>수정 이력</h2>{loadingHistory ? <p>불러오는 중…</p> : revisions.length ? <div className="history-panel">{revisions.map((revision) => <div className="history-item" key={revision.id}><div><span>{revision.action === "edit" ? "수정" : revision.action === "revert" ? "이력 복원" : revision.action === "restore" ? "복원" : "삭제"}</span><time>{new Date(revision.created_at).toLocaleString("ko-KR")}</time></div><p>{revision.previous_content || "(빈 내용)"}</p>{(entry.document_version !== 2 || revision.action === "edit" || revision.action === "revert") && <button className="button" onClick={() => revert(revision)}><RotateCcw size={13} /> 이 상태로 복원</button>}</div>)}</div> : <p>아직 수정 이력이 없습니다.</p>}</section></div>}
  </div>;
});

function TrashPanel({ pageId, onRestore }: { pageId: string; onRestore: (entry: LogEntry) => void }) {
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
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "블록을 복원하지 못했습니다.");
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
    if (result.entry) onRestore(result.entry);
  }
  return <div className="trash-control"><button className="button" onClick={toggle}><Trash2 size={14} /> 휴지통</button>{open && <div className="trash-panel">{entries.length ? entries.map((entry) => <div className="trash-item" key={entry.id}><span>{entry.speaker_name ? `${entry.speaker_name}: ` : ""}{entry.content.slice(0, 80)}</span><button className="button" onClick={() => restore(entry.id)}>복원</button></div>) : <p>휴지통이 비어 있습니다.</p>}</div>}</div>;
}
