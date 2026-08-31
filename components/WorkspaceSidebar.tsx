"use client";

import { Archive, ChevronDown, ChevronRight, FilePlus2, FileText, Folder, FolderOpen, FolderPlus, LogOut, Menu, MoreHorizontal, Pencil, Plus, Settings, Share2, ShieldCheck, Trash2, UserMinus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, FormEvent, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { PageType, ResourceRole, WorkspacePage } from "@/lib/types";
import { defaultCorrectionSettings, type CorrectionSettings } from "@/lib/logs/corrections";
import { useEscapeClose } from "@/lib/use-escape-close";
import { normalizeHexColor } from "@/lib/color";

type CreatePage = (pageType: PageType, parentId?: string | null) => Promise<void>;
type ShareRow = { share_id: string | null; user_id: string | null; username: string; display_name: string | null; access_level: ResourceRole; state: "active" | "pending"; is_owner: boolean };
type GuestParticipantRow = { id: string; nickname: string; accessLevel: "viewer" | "editor"; createdAt: string; lastSeenAt: string };
const ROLE_LABELS: Record<ResourceRole, string> = { viewer: "뷰어", editor: "편집자", admin: "관리자", owner: "소유자" };
const PageTreeContext = createContext<Map<string | null, WorkspacePage[]>>(new Map());
const RESOURCE_DRAG_TYPE = "application/x-logcontainer-resources";
type TreeInteraction = {
  selectedIds: Set<string>;
  draggingIds: string[];
  dropTargetId: string | null;
  select: (event: ReactMouseEvent, resourceId: string) => void;
  startDrag: (event: ReactDragEvent, resourceId: string) => void;
  startPointerDrag: (event: ReactPointerEvent<HTMLButtonElement>, resourceId: string) => void;
  movePointerDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  finishPointerDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  cancelPointerDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  endDrag: () => void;
  setDropTargetId: (resourceId: string | null) => void;
  drop: (event: ReactDragEvent, targetFolderId: string | null) => void;
};
const TreeInteractionContext = createContext<TreeInteraction | null>(null);

function topLevelSelection(resourceIds: string[], pages: WorkspacePage[]) {
  const selected = new Set(resourceIds);
  const parentById = new Map(pages.map((page) => [page.id, page.tree_parent_id ?? null]));
  return resourceIds.filter((resourceId) => {
    let parentId = parentById.get(resourceId) ?? null;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (selected.has(parentId)) return false;
      visited.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
    return true;
  });
}

function OverlayPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? createPortal(children, document.body) : null;
}

export function WorkspaceSidebar({ workspaceId, workspaceName, nickname, accentColor, pages, isSiteAdmin }: { workspaceId: string; workspaceName: string; nickname: string; accentColor: string; pages: WorkspacePage[]; isSiteAdmin: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentWorkspaceName, setCurrentWorkspaceName] = useState(workspaceName);
  const [currentNickname, setCurrentNickname] = useState(nickname);
  const [livePages, setLivePages] = useState(pages);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draggingIds, setDraggingIds] = useState<string[]>([]);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{ x: number; y: number; label: string; count: number } | null>(null);
  const draggingIdsRef = useRef<string[]>([]);
  const dropTargetIdRef = useRef<string | null>(null);
  const pointerDragRef = useRef<{ pointerId: number; startX: number; startY: number; moved: boolean } | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  useEffect(() => setCurrentWorkspaceName(workspaceName), [workspaceName]);
  useEffect(() => setCurrentNickname(nickname), [nickname]);
  useEffect(() => setLivePages(pages), [pages]);
  useEffect(() => { document.title = currentWorkspaceName; }, [currentWorkspaceName]);
  useEffect(() => setMobileSidebarOpen(false), [pathname]);
  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setMobileSidebarOpen(false); };
    document.body.classList.add("sidebar-drawer-open");
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.classList.remove("sidebar-drawer-open");
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileSidebarOpen]);
  const reloadTree = useCallback(async () => {
    try {
      const response = await fetch(`/api/workspace/tree?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json();
      if (response.ok) setLivePages(result.pages ?? []);
    } catch {
      // Preserve the current tree and retry on the next mutation or Realtime event.
    }
  }, [workspaceId]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string | null, WorkspacePage[]>();
    for (const page of livePages) {
      const parentId = page.tree_parent_id ?? null;
      const children = map.get(parentId) ?? [];
      children.push(page);
      map.set(parentId, children);
    }
    return map;
  }, [livePages]);
  const roots = childrenByParent.get(null) ?? [];

  const selectResource = useCallback((event: ReactMouseEvent, resourceId: string) => {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      const visibleIds = Array.from(document.querySelectorAll<HTMLElement>("#workspace-navigation [data-resource-id]")).map((element) => element.dataset.resourceId).filter((value): value is string => Boolean(value));
      const anchorIndex = selectionAnchor.current ? visibleIds.indexOf(selectionAnchor.current) : -1;
      const currentIndex = visibleIds.indexOf(resourceId);
      const range = anchorIndex >= 0 && currentIndex >= 0 ? visibleIds.slice(Math.min(anchorIndex, currentIndex), Math.max(anchorIndex, currentIndex) + 1) : [resourceId];
      setSelectedIds((current) => event.ctrlKey || event.metaKey ? new Set([...current, ...range]) : new Set(range));
    } else {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(resourceId)) next.delete(resourceId); else next.add(resourceId);
        return next;
      });
      selectionAnchor.current = resourceId;
    }
  }, []);

  const prepareResourceDrag = useCallback((resourceId: string) => {
    const selectedForDrag = selectedIds.has(resourceId) ? [...selectedIds] : [resourceId];
    const resourceIds = topLevelSelection(selectedForDrag, livePages);
    draggingIdsRef.current = resourceIds;
    setDraggingIds(resourceIds);
    return resourceIds;
  }, [livePages, selectedIds]);

  const startResourceDrag = useCallback((event: ReactDragEvent, resourceId: string) => {
    const resourceIds = prepareResourceDrag(resourceId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(RESOURCE_DRAG_TYPE, JSON.stringify(resourceIds));
    event.dataTransfer.setData("text/plain", resourceIds.join(","));
  }, [prepareResourceDrag]);

  const setResourceDropTarget = useCallback((resourceId: string | null) => {
    dropTargetIdRef.current = resourceId;
    setDropTargetId(resourceId);
  }, []);

  const endResourceDrag = useCallback(() => {
    draggingIdsRef.current = [];
    setDraggingIds([]);
    setDragPreview(null);
    setResourceDropTarget(null);
  }, [setResourceDropTarget]);

  const moveResources = useCallback(async (resourceIds: string[], targetFolderId: string | null) => {
    const response = await fetch("/api/resources/move", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceIds, targetFolderId }) });
    const result = await response.json();
    if (!response.ok) return window.alert(result.error ?? "리소스를 이동하지 못했습니다.");
    setSelectedIds(new Set());
    selectionAnchor.current = null;
    await reloadTree();
  }, [reloadTree]);

  const dropResources = useCallback((event: ReactDragEvent, targetFolderId: string | null) => {
    event.preventDefault();
    event.stopPropagation();
    let resourceIds = draggingIdsRef.current.length ? draggingIdsRef.current : draggingIds;
    try {
      const parsed = JSON.parse(event.dataTransfer.getData(RESOURCE_DRAG_TYPE));
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string")) resourceIds = parsed;
    } catch {
      const plainText = event.dataTransfer.getData("text/plain");
      if (plainText) resourceIds = plainText.split(",").map((value) => value.trim()).filter(Boolean);
    }
    endResourceDrag();
    if (resourceIds.length) void moveResources(resourceIds, targetFolderId);
  }, [draggingIds, endResourceDrag, moveResources]);

  const startResourcePointerDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>, resourceId: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const resourceIds = prepareResourceDrag(resourceId);
    const resource = livePages.find((page) => page.id === resourceId);
    setDragPreview({ x: event.clientX, y: event.clientY, label: resource?.title ?? "리소스", count: resourceIds.length });
    pointerDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [livePages, prepareResourceDrag]);

  const moveResourcePointerDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointer = pointerDragRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (!pointer.moved && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 4) return;
    pointer.moved = true;
    event.preventDefault();
    setDragPreview((current) => current ? { ...current, x: event.clientX, y: event.clientY } : current);
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (hit?.closest(".workspace-root-drop")) return setResourceDropTarget("root");
    const row = hit?.closest<HTMLElement>("[data-resource-id]");
    const target = row?.dataset.resourceId ? livePages.find((page) => page.id === row.dataset.resourceId) : null;
    setResourceDropTarget(target?.page_type === "folder" && !draggingIdsRef.current.includes(target.id) ? target.id : null);
  }, [livePages, setResourceDropTarget]);

  const finishResourcePointerDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const pointer = pointerDragRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const resourceIds = [...draggingIdsRef.current];
    const target = dropTargetIdRef.current;
    endResourceDrag();
    if (pointer.moved && target && resourceIds.length) void moveResources(resourceIds, target === "root" ? null : target);
  }, [endResourceDrag, moveResources]);

  const cancelResourcePointerDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (pointerDragRef.current?.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    endResourceDrag();
  }, [endResourceDrag]);

  const treeInteraction = useMemo<TreeInteraction>(() => ({ selectedIds, draggingIds, dropTargetId, select: selectResource, startDrag: startResourceDrag, startPointerDrag: startResourcePointerDrag, movePointerDrag: moveResourcePointerDrag, finishPointerDrag: finishResourcePointerDrag, cancelPointerDrag: cancelResourcePointerDrag, endDrag: endResourceDrag, setDropTargetId: setResourceDropTarget, drop: dropResources }), [selectedIds, draggingIds, dropTargetId, selectResource, startResourceDrag, startResourcePointerDrag, moveResourcePointerDrag, finishResourcePointerDrag, cancelResourcePointerDrag, endResourceDrag, setResourceDropTarget, dropResources]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void reloadTree(), 250); };
    const channel = supabase.channel(`workspace-tree-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "folder_items" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "resource_shares" }, refresh)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(channel); };
  }, [reloadTree, workspaceId]);

  async function createPage(pageType: PageType, parentId: string | null = null) {
    setCreating(true);
    const response = await fetch("/api/pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId, pageType, parentId }) });
    const result = await response.json(); setCreating(false);
    if (!response.ok) return window.alert(result.error ?? "페이지를 만들지 못했습니다.");
    await reloadTree();
    if (pageType === "log") router.push(`/workspace/pages/${result.id}`);
  }

  async function logout() { await createSupabaseBrowserClient().auth.signOut(); window.location.assign("/login"); }

  return <>
    <button className="mobile-sidebar-toggle" onClick={() => setMobileSidebarOpen(true)} aria-expanded={mobileSidebarOpen} aria-controls="workspace-navigation"><Menu size={19} /><span>메뉴</span></button>
    <button className={`workspace-sidebar-scrim ${mobileSidebarOpen ? "is-open" : ""}`} onClick={() => setMobileSidebarOpen(false)} aria-label="메뉴 닫기" tabIndex={mobileSidebarOpen ? 0 : -1} />
    <aside id="workspace-navigation" className={`workspace-sidebar ${mobileSidebarOpen ? "mobile-open" : ""}`}>
    <div className="workspace-title-row"><div className="workspace-title">{currentWorkspaceName}</div><button className="mobile-sidebar-close" onClick={() => setMobileSidebarOpen(false)} aria-label="메뉴 닫기"><X size={19} /></button></div>
    <div className="sidebar-create-actions">
      <button className="sidebar-action" onClick={() => createPage("log")} disabled={creating}><Plus size={16} />새 로그</button>
      <button className="sidebar-action" onClick={() => createPage("folder")} disabled={creating}><FolderPlus size={15} />새 폴더</button>
    </div>
    {selectedIds.size > 0 && <div className="sidebar-selection-status"><span>{selectedIds.size}개 선택됨</span><button onClick={() => setSelectedIds(new Set())}>선택 해제</button></div>}
    <div className={`workspace-root-drop ${draggingIds.length ? "is-visible" : ""} ${dropTargetId === "root" ? "drop-target" : ""}`} aria-hidden={!draggingIds.length} onDragEnter={(event) => { if (!draggingIdsRef.current.length) return; event.preventDefault(); setDropTargetId("root"); }} onDragOver={(event) => { if (!draggingIdsRef.current.length) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTargetId("root"); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTargetId(null); }} onDrop={(event) => dropResources(event, null)}>최상위로 이동</div>
    <TreeInteractionContext.Provider value={treeInteraction}><PageTreeContext.Provider value={childrenByParent}><nav className="page-tree" aria-label="페이지">{roots.map((page) => <PageNode key={page.id} page={page} pages={livePages} depth={0} createPage={createPage} reloadTree={reloadTree} />)}{!roots.length && <p className="sidebar-empty">아직 페이지가 없습니다.</p>}</nav></PageTreeContext.Provider></TreeInteractionContext.Provider>
    <div className="sidebar-footer"><TrashPanel onChanged={reloadTree} /><button className="sidebar-action" onClick={() => setSettingsOpen(true)}><Settings size={15} />설정</button>{isSiteAdmin && <Link className="sidebar-action" href="/workspace/admin/accounts"><ShieldCheck size={15} />계정 관리</Link>}<button className="sidebar-action" onClick={logout}><LogOut size={15} />로그아웃</button></div>
    {settingsOpen && <WorkspaceSettingsDialog workspaceName={currentWorkspaceName} nickname={currentNickname} accentColor={accentColor} onClose={() => setSettingsOpen(false)} onSaved={(next) => { setCurrentWorkspaceName(next.workspaceName); setCurrentNickname(next.nickname); document.querySelector<HTMLElement>(".workspace-shell")?.style.setProperty("--accent", next.accentColor); setSettingsOpen(false); }} />}
    {dragPreview && <OverlayPortal><div className="pointer-drag-preview" style={{ left: dragPreview.x, top: dragPreview.y }}><span className="pointer-drag-preview__grip">⋮⋮</span><strong>{dragPreview.label}</strong>{dragPreview.count > 1 && <small>외 {dragPreview.count - 1}개</small>}</div></OverlayPortal>}
    </aside>
  </>;
}

function WorkspaceSettingsDialog({ workspaceName, nickname, accentColor, onClose, onSaved }: { workspaceName: string; nickname: string; accentColor: string; onClose: () => void; onSaved: (next: { workspaceName: string; nickname: string; accentColor: string }) => void }) {
  const [nextWorkspaceName, setNextWorkspaceName] = useState(workspaceName);
  const [nextNickname, setNextNickname] = useState(nickname);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [nextAccentColor, setNextAccentColor] = useState(accentColor);
  const [correctionSettings, setCorrectionSettings] = useState<CorrectionSettings>(defaultCorrectionSettings);
  useEscapeClose(onClose, pending);
  useEffect(() => { void fetch("/api/account/settings").then((response) => response.json()).then((result) => { if (result.accentColor) setNextAccentColor(result.accentColor); if (result.correctionSettings) setCorrectionSettings(result.correctionSettings); }); }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/account/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceName: nextWorkspaceName, nickname: nextNickname, accentColor: nextAccentColor, correctionSettings }) });
      const result = await response.json();
      if (!response.ok) return setError(result.error ?? "설정을 저장하지 못했습니다.");
      onSaved({ workspaceName: result.workspaceName, nickname: result.nickname, accentColor: result.accentColor });
    } catch {
      setError("설정을 저장하지 못했습니다.");
    } finally {
      setPending(false);
    }
  }
  const toggles: Array<[keyof CorrectionSettings, string]> = [["remove_html_tags", "HTML 태그 제거"], ["normalize_ellipsis", "말줄임표 통일"], ["normalize_quotes", "큰따옴표 통일"], ["speaker_tab_format", "화자명 뒤에 탭"], ["clean_blank_lines", "빈 줄 정리"], ["mark_handout_position", "이미지·핸드아웃 위치 표시"]];
  const normalizedAccent = normalizeHexColor(nextAccentColor);
  return <OverlayPortal><div className="modal-backdrop" onMouseDown={pending ? undefined : onClose}><section className="modal-card settings-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} aria-label="닫기" disabled={pending}><X size={17} /></button><h2>설정</h2><p>개인 워크스페이스, 표시 색상과 TXT 기본값을 변경합니다.</p><form onSubmit={save}><label className="field">워크스페이스 이름<input value={nextWorkspaceName} onChange={(event) => setNextWorkspaceName(event.target.value)} maxLength={100} required /></label><label className="field">닉네임<input value={nextNickname} onChange={(event) => setNextNickname(event.target.value)} maxLength={80} required /></label><div className="field"><span>포인트 색상</span><div className="accent-color-row"><input className="accent-color-chip" aria-label="포인트 색상 선택" type="color" value={normalizedAccent ?? accentColor} onChange={(event) => setNextAccentColor(event.target.value.toUpperCase())} /><input aria-label="포인트 색상 HEX" value={nextAccentColor} maxLength={7} onChange={(event) => setNextAccentColor(event.target.value)} onBlur={() => { const normalized = normalizeHexColor(nextAccentColor); if (normalized) setNextAccentColor(normalized); }} placeholder="#4F6BED" aria-invalid={!normalizedAccent} /></div>{!normalizedAccent && <small className="field-error">#RGB 또는 #RRGGBB 형식으로 입력해주세요.</small>}</div><fieldset><legend>TXT 교정 기본값</legend><div className="correction-toggles">{toggles.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(correctionSettings[key])} onChange={(event) => setCorrectionSettings((current) => ({ ...current, [key]: event.target.checked }))} /> {label}</label>)}</div><div className="correction-symbols"><label>여는 따옴표<input value={correctionSettings.custom_quote_open} maxLength={8} onChange={(event) => setCorrectionSettings((current) => ({ ...current, custom_quote_open: event.target.value }))} /></label><label>닫는 따옴표<input value={correctionSettings.custom_quote_close} maxLength={8} onChange={(event) => setCorrectionSettings((current) => ({ ...current, custom_quote_close: event.target.value }))} /></label><label>말줄임표<input value={correctionSettings.custom_ellipsis} maxLength={8} onChange={(event) => setCorrectionSettings((current) => ({ ...current, custom_ellipsis: event.target.value }))} /></label><label>핸드아웃 기호<input value={correctionSettings.custom_handout_icon} maxLength={8} onChange={(event) => setCorrectionSettings((current) => ({ ...current, custom_handout_icon: event.target.value }))} /></label></div></fieldset>{error && <p className="error">{error}</p>}<div className="modal-actions"><button className="button" type="button" onClick={onClose} disabled={pending}>취소</button><button className="button button-primary" disabled={pending || !normalizedAccent}>{pending ? "저장 중…" : "저장"}</button></div></form></section></div></OverlayPortal>;
}

function TrashPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [resources, setResources] = useState<Array<{ id: string; title: string; deleted_at: string; purge_after: string }>>([]);
  async function toggle() { const next = !open; setOpen(next); if (!next) return; const response = await fetch("/api/resources/trash"); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "휴지통을 불러오지 못했습니다."); setResources(result.resources ?? []); }
  async function action(resourceId: string, permanent = false) { if (permanent && !window.confirm("이 리소스를 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.")) return; const response = await fetch("/api/resources/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resourceId, permanent }) }); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "휴지통 작업을 완료하지 못했습니다."); setResources((current) => current.filter((resource) => resource.id !== resourceId)); await onChanged(); }
  return <div className="sidebar-popover-wrap"><button className="sidebar-action" onClick={toggle}><Archive size={15} />휴지통</button>{open && <div className="sidebar-popover">{resources.length ? resources.map((resource) => <div className="sidebar-popover-item trash-resource" key={resource.id}><span><strong>{resource.title}</strong><small>{Math.max(0, Math.ceil((new Date(resource.purge_after).getTime() - Date.now()) / 86400000))}일 후 삭제</small></span><span className="row-actions"><button className="button" onClick={() => action(resource.id)}>복원</button><button className="button button-danger" onClick={() => action(resource.id, true)}>영구 삭제</button></span></div>) : <p>휴지통이 비어 있습니다.</p>}</div>}</div>;
}

function PageNode({ page, pages, depth, createPage, reloadTree }: { page: WorkspacePage; pages: WorkspacePage[]; depth: number; createPage: CreatePage; reloadTree: () => Promise<void> }) {
  const pathname = usePathname(); const router = useRouter();
  const childrenByParent = useContext(PageTreeContext);
  const treeInteraction = useContext(TreeInteractionContext);
  const children = childrenByParent.get(page.id) ?? [];
  const [expanded, setExpanded] = useState(true); const [menu, setMenu] = useState<{ x: number; y: number } | null>(null); const [sharing, setSharing] = useState(false); const [moving, setMoving] = useState(false);
  const paddingLeft = 9 + depth * 15; const href = page.page_type === "log" ? `/workspace/pages/${page.id}` : null;
  async function rename() { setMenu(null); const title = window.prompt("새 이름", page.title)?.trim(); if (!title || title === page.title) return; const response = await fetch(`/api/pages/${page.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "이름을 바꾸지 못했습니다."); await reloadTree(); }
  async function remove() { setMenu(null); const owner = Boolean(page.is_original_owner); if (!owner && !page.can_self_remove) return; if (!window.confirm(owner ? "이 리소스를 30일 휴지통으로 이동할까요? 공유자에게도 즉시 숨겨집니다." : "내 워크스페이스에서 제거하고 내 직접 공유 권한을 종료할까요?")) return; const response = owner ? await fetch(`/api/pages/${page.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isArchived: true }) }) : await fetch(`/api/resources/${page.id}/remove`, { method: "POST" }); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "리소스를 제거하지 못했습니다."); await reloadTree(); if (pathname === href) router.push("/workspace"); }
  async function removeFromFolder() { setMenu(null); if (page.tree_relation !== "folder" || !page.tree_parent_id || !window.confirm("공유 폴더에서 이 항목을 제거할까요? 폴더를 보는 모든 사람에게 반영됩니다. 리소스 자체는 삭제되지 않습니다.")) return; const response = await fetch(`/api/resources/${page.tree_parent_id}/children`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ childId: page.id }) }); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "폴더에서 제거하지 못했습니다."); await reloadTree(); }
  const selected = Boolean(treeInteraction?.selectedIds.has(page.id));
  const dropTarget = page.page_type === "folder" && treeInteraction?.dropTargetId === page.id;
  const dragging = Boolean(treeInteraction?.draggingIds.includes(page.id));
  const row = <div className={`page-link tree-row ${href && pathname === href ? "active" : ""} ${selected ? "selected" : ""} ${dragging ? "dragging" : ""} ${dropTarget ? "drop-target" : ""}`} style={{ paddingLeft }} data-resource-id={page.id} onClick={(event) => treeInteraction?.select(event, page.id)} onDragEnter={page.page_type === "folder" ? (event) => { event.preventDefault(); treeInteraction?.setDropTargetId(page.id); } : undefined} onDragOver={page.page_type === "folder" ? (event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; treeInteraction?.setDropTargetId(page.id); } : undefined} onDragLeave={page.page_type === "folder" ? (event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) treeInteraction?.setDropTargetId(null); } : undefined} onDrop={page.page_type === "folder" ? (event) => treeInteraction?.drop(event, page.id) : undefined}>
    <button type="button" className="tree-drag-handle" aria-label={`${page.title} 이동`} title="끌어서 이동" onClick={(event) => event.stopPropagation()} onPointerDown={(event) => treeInteraction?.startPointerDrag(event, page.id)} onPointerMove={(event) => treeInteraction?.movePointerDrag(event)} onPointerUp={(event) => treeInteraction?.finishPointerDrag(event)} onPointerCancel={(event) => treeInteraction?.cancelPointerDrag(event)}>⋮⋮</button>
    {page.page_type === "folder" ? <><button className="tree-toggle" onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>{expanded ? <FolderOpen size={15} /> : <Folder size={15} />}</> : <span className="tree-file-spacer"><FileText size={15} /></span>}
    {href ? <Link href={href} prefetch={false} className="tree-title">{page.title}</Link> : <span className="tree-title">{page.title}</span>}
    {page.page_type === "folder" && page.can_edit && <><button className="tree-add" onClick={() => createPage("log", page.id)} title="이 폴더에 로그 추가"><FilePlus2 size={14} /></button><button className="tree-add tree-add-secondary" onClick={() => createPage("folder", page.id)} title="이 폴더에 하위 폴더 추가"><FolderPlus size={14} /></button></>}
    <button className="tree-more" onClick={(event) => { event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect(); setMenu({ x: rect.right, y: rect.bottom }); }} aria-label={`${page.title} 메뉴`} aria-haspopup="menu" title="메뉴"><MoreHorizontal size={14} /></button>
  </div>;
  return <div className={page.page_type === "folder" ? "tree-folder" : "tree-page"}>{row}{expanded && children.map((child) => <PageNode key={child.id} page={child} pages={pages} depth={depth + 1} createPage={createPage} reloadTree={reloadTree} />)}{menu && <ResourceMenu x={menu.x} y={menu.y} page={page} onClose={() => setMenu(null)} onRename={rename} onShare={() => { setMenu(null); setSharing(true); }} onMove={() => { setMenu(null); setMoving(true); }} onRemove={page.is_original_owner || page.can_self_remove ? remove : undefined} onRemoveFromFolder={page.tree_relation === "folder" ? removeFromFolder : undefined} />}{sharing && <ShareDialog page={page} onClose={() => setSharing(false)} />}{moving && <MoveDialog page={page} pages={pages} reloadTree={reloadTree} onClose={() => setMoving(false)} />}</div>;
}

function ResourceMenu({ x, y, page, onClose, onRename, onShare, onMove, onRemove, onRemoveFromFolder }: { x: number; y: number; page: WorkspacePage; onClose: () => void; onRename: () => void; onShare: () => void; onMove: () => void; onRemove?: () => void; onRemoveFromFolder?: () => void }) {
  useEffect(() => { const close = () => onClose(); window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close); }, [onClose]);
  return <OverlayPortal><div className="entry-context-menu resource-context-menu" role="menu" style={{ left: Math.min(x, window.innerWidth - 210), top: Math.min(y, window.innerHeight - 250) }} onPointerDown={(event) => event.stopPropagation()}>{page.can_edit && <button onClick={onRename}><Pencil size={13} />이름 변경</button>}{page.can_manage_shares && <button onClick={onShare}><Share2 size={13} />공유</button>}<button onClick={onMove}><Folder size={13} />내 위치 이동</button>{page.can_edit && onRemoveFromFolder && <button onClick={onRemoveFromFolder}><UserMinus size={13} />공유 폴더에서 제거</button>}{onRemove && <><hr /><button className="danger" onClick={onRemove}><Trash2 size={13} />{page.is_original_owner ? "휴지통으로 이동" : "내 워크스페이스에서 제거"}</button></>}</div></OverlayPortal>;
}

function MoveDialog({ page, pages, reloadTree, onClose }: { page: WorkspacePage; pages: WorkspacePage[]; reloadTree: () => Promise<void>; onClose: () => void }) {
  const [parentId, setParentId] = useState(""); const folders = pages.filter((candidate) => candidate.page_type === "folder" && candidate.id !== page.id);
  useEscapeClose(onClose);
  async function finish(response: Response) { const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "이동하지 못했습니다."); await reloadTree(); onClose(); }
  async function movePersonal() { await finish(await fetch(`/api/resources/${page.id}/placement`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ parentId: parentId || null }) })); }
  async function moveShared() { if (!parentId) return window.alert("공유 구조의 대상 폴더를 선택해주세요."); await finish(await fetch(`/api/resources/${parentId}/children`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ childId: page.id }) })); }
  return <OverlayPortal><div className="modal-backdrop" onMouseDown={onClose}><section className="modal-card" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose}><X size={17} /></button><h2>리소스 이동</h2><p>‘내 위치만 이동’은 나에게만 적용됩니다.{page.can_edit && " ‘공유 구조로 이동’은 Folder 내부 hierarchy를 바꾸므로 모든 공유자에게 반영되며, 서버가 재공유 권한을 검사합니다."}</p><label className="field">위치<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">최상위</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.title}</option>)}</select></label><div className="modal-actions"><button className="button" onClick={onClose}>취소</button><button className="button" onClick={movePersonal}>내 위치만 이동</button>{page.can_edit && <button className="button button-primary" onClick={moveShared} disabled={!parentId}>공유 구조로 이동</button>}</div></section></div></OverlayPortal>;
}

export function ShareDialog({ page, onClose }: { page: WorkspacePage; onClose: () => void }) {
  const [shares, setShares] = useState<ShareRow[]>([]); const [actorRole, setActorRole] = useState<ResourceRole>(page.resource_role ?? "viewer"); const [allowedRoles, setAllowedRoles] = useState<ResourceRole[]>([]); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false); const [message, setMessage] = useState("");
  const [guestLink, setGuestLink] = useState<{ isActive: boolean; defaultAccessLevel: "viewer" | "editor" } | null>(null); const [guests, setGuests] = useState<GuestParticipantRow[]>([]); const [guestUrl, setGuestUrl] = useState("");
  useEscapeClose(onClose, pending);
  async function load() { const [response, guestResponse] = await Promise.all([fetch(`/api/resources/${page.id}/shares`), page.page_type === "log" ? fetch(`/api/pages/${page.id}/guest-link`) : Promise.resolve(null)]); const result = await response.json(); setLoading(false); if (!response.ok) return setMessage(result.error ?? "공유 정보를 불러오지 못했습니다."); setShares(result.shares ?? []); setActorRole(result.actorRole); setAllowedRoles(result.allowedRoles ?? []); if (guestResponse) { const guestResult = await guestResponse.json(); if (guestResponse.ok) { setGuestLink(guestResult.link); setGuests(guestResult.participants ?? []); } } }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function add(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setMessage(""); setPending(true); const form = new FormData(event.currentTarget); const response = await fetch(`/api/resources/${page.id}/shares`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: form.get("username"), accessLevel: form.get("accessLevel") }) }); const result = await response.json(); setPending(false); if (!response.ok) return setMessage(result.error ?? "공유하지 못했습니다."); setMessage(result.state === "pending" ? "가입 또는 승인을 기다리는 공유 예약으로 저장했습니다." : "공유했습니다."); event.currentTarget.reset(); await load(); }
  async function changeRole(share: ShareRow, accessLevel: ResourceRole) { if (!share.share_id) return; setPending(true); const response = await fetch(`/api/resources/${page.id}/shares`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ shareId: share.share_id, state: share.state, accessLevel }) }); const result = await response.json(); setPending(false); if (!response.ok) return window.alert(result.error ?? "공유 권한을 바꾸지 못했습니다."); await load(); }
  async function revoke(share: ShareRow) { if (!window.confirm(`@${share.username}의 공유 권한을 회수할까요?`)) return; const response = await fetch(`/api/resources/${page.id}/shares`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ shareId: share.share_id, state: share.state }) }); const result = await response.json(); if (!response.ok) return window.alert(result.error ?? "공유를 해제하지 못했습니다."); await load(); }
  async function enableGuestLink() { setPending(true); const response = await fetch(`/api/pages/${page.id}/guest-link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultAccessLevel: guestLink?.defaultAccessLevel ?? "viewer" }) }); const result = await response.json(); setPending(false); if (!response.ok) return window.alert(result.error ?? "Guest 링크를 만들지 못했습니다."); setGuestLink(result.link); setGuestUrl(`${window.location.origin}${result.url}`); }
  async function changeGuestDefault(defaultAccessLevel: "viewer" | "editor") { setPending(true); const response = await fetch(`/api/pages/${page.id}/guest-link`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultAccessLevel }) }); const result = await response.json(); setPending(false); if (!response.ok) return window.alert(result.error ?? "Guest 기본 권한을 바꾸지 못했습니다."); setGuestLink(result.link); }
  async function disableGuestLink() { if (!window.confirm("Guest 링크를 중지하고 모든 Guest 세션을 종료할까요?")) return; setPending(true); const response = await fetch(`/api/pages/${page.id}/guest-link`, { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" }); const result = await response.json(); setPending(false); if (!response.ok) return window.alert(result.error ?? "Guest 링크를 중지하지 못했습니다."); setGuestLink(result.link); setGuestUrl(""); }
  async function changeGuest(guest: GuestParticipantRow, accessLevel: "viewer" | "editor") { setPending(true); const response = await fetch(`/api/pages/${page.id}/guest-link`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: guest.id, accessLevel }) }); const result = await response.json(); setPending(false); if (!response.ok) return window.alert(result.error ?? "Guest 권한을 바꾸지 못했습니다."); await load(); }
  async function revokeGuest(guest: GuestParticipantRow) { if (!window.confirm(`${guest.nickname} Guest를 제거할까요?`)) return; setPending(true); const response = await fetch(`/api/pages/${page.id}/guest-link`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ participantId: guest.id }) }); const result = await response.json(); setPending(false); if (!response.ok) return window.alert(result.error ?? "Guest를 제거하지 못했습니다."); await load(); }
  return <OverlayPortal><div className="modal-backdrop" onMouseDown={pending ? undefined : onClose}><section className="modal-card share-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose} disabled={pending}><X size={17} /></button><h2>{page.title} 공유</h2><p>{page.page_type === "folder" ? "폴더와 내부 구조가 함께 공유됩니다." : "상대방 워크스페이스에 이 페이지만 나타납니다."}</p><form className="share-form" onSubmit={add}><label className="field">사용자 아이디<input name="username" placeholder="username" minLength={2} required disabled={pending} /></label><label className="field">권한<select name="accessLevel" defaultValue="viewer" disabled={pending}>{allowedRoles.map((role) => <option value={role} key={role}>{ROLE_LABELS[role]}</option>)}</select></label><button className="button button-primary" disabled={pending}>{pending ? "공유 중…" : "공유"}</button></form>{message && <p>{message}</p>}<div className="member-list">{loading ? <p>불러오는 중…</p> : shares.map((share) => { const protectedAdmin = actorRole === "admin" && share.access_level === "admin"; return <div className="member-row" key={share.share_id ?? `owner-${share.user_id}`}><div className="member-identity"><strong>{share.display_name || `@${share.username}`}</strong><small>@{share.username}{share.state === "pending" ? " · 대기 중" : ""}</small></div><div className="row-actions">{share.is_owner ? <span>{ROLE_LABELS.owner}</span> : <><select aria-label={`@${share.username} 권한`} value={share.access_level} disabled={pending || protectedAdmin} onChange={(event) => void changeRole(share, event.target.value as ResourceRole)}>{allowedRoles.map((role) => <option value={role} key={role}>{ROLE_LABELS[role]}</option>)}{protectedAdmin && <option value="admin">{ROLE_LABELS.admin}</option>}</select>{!protectedAdmin && <button className="button button-danger" aria-label={`@${share.username} 권한 제거`} onClick={() => revoke(share)} disabled={pending}>×</button>}</>}</div></div>; })}</div>{page.page_type === "log" && <section className="guest-share-section"><h3>Guest 링크</h3>{guestLink?.isActive ? <><label className="field">새 Guest 기본 권한<select value={guestLink.defaultAccessLevel} onChange={(event) => void changeGuestDefault(event.target.value as "viewer" | "editor")} disabled={pending}><option value="viewer">뷰어</option><option value="editor">편집자</option></select></label>{guestUrl ? <button className="button" onClick={() => navigator.clipboard.writeText(guestUrl)}>링크 복사</button> : <button className="button" onClick={enableGuestLink} disabled={pending}>링크 다시 생성</button>}<button className="button button-danger" onClick={disableGuestLink} disabled={pending}>Guest 링크 중지</button></> : <button className="button button-primary" onClick={enableGuestLink} disabled={pending}>Guest 링크 사용</button>}<div className="member-list">{guests.map((guest) => <div className="member-row" key={guest.id}><div className="member-identity"><strong>{guest.nickname}</strong><small>손님</small></div><div className="row-actions"><select value={guest.accessLevel} onChange={(event) => void changeGuest(guest, event.target.value as "viewer" | "editor")} disabled={pending}><option value="viewer">뷰어</option><option value="editor">편집자</option></select><button className="button button-danger" onClick={() => revokeGuest(guest)} disabled={pending}>×</button></div></div>)}</div></section>}</section></div></OverlayPortal>;
}
