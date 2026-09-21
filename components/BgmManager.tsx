"use client";

import { ChevronDown, ChevronRight, GripVertical, ListMusic, Music, Pencil, Plus, Trash2, Upload as UploadIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { BgmAsset, BgmLibraryItem, BgmPlaylist } from "@/lib/types";
import { BgmUploadDialog } from "@/components/BgmUploadDialog";
import { BgmDetailsDialog, BgmTrackPickerDialog } from "@/components/BgmDetailsDialog";

const MAX_BATCH_FILES = 50;
const COLLAPSED_KEY = "logcontainer:collapsed-bgm-playlists";

function originalFileLabel(asset: BgmAsset) {
  if (asset.source_type !== "upload") return "YouTube";
  return asset.original_filename ? `원본: ${asset.original_filename}` : "MP3 · 원본 파일명 기록 없음";
}

export function BgmManager() {
  const [items, setItems] = useState<BgmLibraryItem[]>([]);
  const [playlists, setPlaylists] = useState<BgmPlaylist[]>([]);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [dialog, setDialog] = useState<Omit<Parameters<typeof BgmDetailsDialog>[0], "onClose"> | null>(null);
  const [picking, setPicking] = useState<BgmPlaylist | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const dragRef = useRef<{ playlistId: string; itemId: string; originalIds: string[]; currentIds: string[]; dropped: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [libraryResponse, playlistResponse] = await Promise.all([fetch("/api/bgm/library", { cache: "no-store" }), fetch("/api/bgm/playlists", { cache: "no-store" })]);
    const [library, playlist] = await Promise.all([libraryResponse.json(), playlistResponse.json()]);
    if (!libraryResponse.ok || !playlistResponse.ok) throw new Error(library.error ?? playlist.error ?? "BGM 보관함을 불러오지 못했습니다.");
    setLoadError("");
    setItems(library.items ?? []);
    setPlaylists(playlist.playlists ?? []);
  }, []);
  useEffect(() => { void load().catch((error) => setLoadError(error instanceof Error ? error.message : "목록 오류")); }, [load]);
  useEffect(() => {
    try { setCollapsed(new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]"))); } catch { /* Ignore corrupt local UI preferences. */ }
  }, []);

  function togglePlaylist(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }
  async function requestJson(path: string, method: string, body?: object) {
    const response = await fetch(path, { method, ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "BGM을 저장하지 못했습니다.");
    return result;
  }
  async function saveDetails(path: string, method: string, body: object) {
    setPending(true);
    try {
      const result = await requestJson(path, method, body);
      if (result.sourceUpdated) window.dispatchEvent(new CustomEvent("bgm-source-updated", { detail: { assetId: result.assetId } }));
      await load();
      return result;
    } finally { setPending(false); }
  }
  async function upload(file: File, title: string) {
    if (!/\.mp3$/i.test(file.name) || file.size <= 0 || file.size > 25_000_000) throw new Error("25MB 이하 MP3 파일만 사용할 수 있습니다.");
    const target = await requestJson("/api/bgm/upload", "POST", { title, originalFilename: file.name, mimeType: "audio/mpeg", byteSize: file.size });
    const { error } = await createSupabaseBrowserClient().storage.from("bgm-audio").uploadToSignedUrl(target.path, target.token, file, { contentType: "audio/mpeg" });
    if (error) throw new Error("MP3를 업로드하지 못했습니다.");
    await requestJson("/api/bgm/upload", "PATCH", { assetId: target.assetId });
  }
  function chooseUploadFiles(fileList: FileList | null) {
    const selected = Array.from(fileList ?? []);
    if (!selected.length) return;
    if (selected.length > MAX_BATCH_FILES) return window.alert(`한 번에 최대 ${MAX_BATCH_FILES}곡까지 업로드할 수 있습니다.`);
    const invalid = selected.find((file) => !/\.mp3$/i.test(file.name) || file.size <= 0 || file.size > 25_000_000);
    if (invalid) return window.alert(`${invalid.name}: 25MB 이하 MP3 파일만 사용할 수 있습니다.`);
    setUploadFiles(selected);
  }
  function rename(item: BgmLibraryItem) {
    setDialog({ heading: "BGM 수정", initialTitle: item.custom_title || item.asset.canonical_title, ...(item.asset.source_type === "youtube" ? { initialUrl: `https://www.youtube.com/watch?v=${item.asset.youtube_video_id}`, canEditUrl: Boolean(item.can_edit_source) } : {}), description: "이름은 내 보관함에서만 변경됩니다. YouTube 링크를 바꾸면 같은 곡을 사용하는 모든 페이지와 플레이리스트의 재생 원본이 바뀝니다. 재생 중인 곡은 멈추며 다음 재생부터 반영됩니다.", onSave: (values) => saveDetails("/api/bgm/library", "PATCH", { id: item.id, ...values }) });
  }
  async function remove(item: BgmLibraryItem) {
    if (!window.confirm("개인 BGM 보관함에서 제거할까요? 페이지와 다른 사용자의 참조는 유지됩니다.")) return;
    try { await requestJson(`/api/bgm/library?id=${item.id}`, "DELETE"); await load(); } catch (error) { window.alert(error instanceof Error ? error.message : "BGM을 제거하지 못했습니다."); }
  }
  function createPlaylist() { setDialog({ heading: "새 플레이리스트", onSave: (values) => saveDetails("/api/bgm/playlists", "POST", values) }); }
  function renamePlaylist(playlist: BgmPlaylist) { setDialog({ heading: "플레이리스트 이름 수정", initialTitle: playlist.title, onSave: (values) => saveDetails("/api/bgm/playlists", "PATCH", { id: playlist.id, ...values }) }); }
  async function deletePlaylist(playlist: BgmPlaylist) {
    if (!window.confirm("플레이리스트를 삭제할까요? BGM 보관함과 페이지 연결은 유지됩니다.")) return;
    try { await requestJson(`/api/bgm/playlists?id=${playlist.id}`, "DELETE"); await load(); } catch (error) { window.alert(error instanceof Error ? error.message : "플레이리스트를 삭제하지 못했습니다."); }
  }
  async function removePlaylistItem(playlist: BgmPlaylist, itemId: string) {
    try { await requestJson(`/api/bgm/playlists/items?playlistId=${playlist.id}&id=${itemId}`, "DELETE"); await load(); } catch (error) { window.alert(error instanceof Error ? error.message : "곡을 제거하지 못했습니다."); }
  }
  function renamePlaylistItem(playlist: BgmPlaylist, itemId: string, currentTitle: string) {
    setDialog({ heading: "플레이리스트 곡 이름 수정", initialTitle: currentTitle, onSave: (values) => saveDetails("/api/bgm/playlists/items", "PATCH", { playlistId: playlist.id, id: itemId, customTitle: values.title }) });
  }
  async function addPlaylistItems(playlist: BgmPlaylist, assetIds: string[]) {
    const result = await requestJson("/api/bgm/playlists/items", "POST", { playlistId: playlist.id, assetIds });
    await load();
    return result;
  }

  function beginDrag(event: DragEvent<HTMLButtonElement>, playlist: BgmPlaylist, itemId: string) {
    dragRef.current = { playlistId: playlist.id, itemId, originalIds: playlist.items.map((item) => item.id), currentIds: playlist.items.map((item) => item.id), dropped: false };
    setDraggingItemId(itemId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", itemId);
  }
  function previewDrag(event: DragEvent<HTMLDivElement>, playlistId: string, targetItemId: string) {
    const dragging = dragRef.current;
    if (!dragging || dragging.playlistId !== playlistId || dragging.itemId === targetItemId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setPlaylists((current) => current.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const next = playlist.items.filter((item) => item.id !== dragging.itemId);
      const targetIndex = next.findIndex((item) => item.id === targetItemId);
      if (targetIndex < 0) return playlist;
      const after = event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2;
      const moving = playlist.items.find((item) => item.id === dragging.itemId);
      if (!moving) return playlist;
      next.splice(targetIndex + (after ? 1 : 0), 0, moving);
      dragging.currentIds = next.map((item) => item.id);
      return { ...playlist, items: next.map((item, index) => ({ ...item, sort_order: index })) };
    }));
  }
  async function finishDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const dragging = dragRef.current;
    if (!dragging) return;
    dragging.dropped = true;
    try { await requestJson("/api/bgm/playlists/items", "PATCH", { playlistId: dragging.playlistId, itemIds: dragging.currentIds }); }
    catch (error) { setPlaylists((current) => current.map((playlist) => playlist.id === dragging.playlistId ? { ...playlist, items: dragging.originalIds.map((id) => playlist.items.find((item) => item.id === id)).filter((item): item is BgmPlaylist["items"][number] => Boolean(item)) } : playlist)); window.alert(error instanceof Error ? error.message : "곡 순서를 바꾸지 못했습니다."); }
    finally { dragRef.current = null; setDraggingItemId(null); }
  }
  function cancelDrag() {
    const dragging = dragRef.current;
    if (!dragging || dragging.dropped) return;
    setPlaylists((current) => current.map((playlist) => playlist.id === dragging.playlistId ? { ...playlist, items: dragging.originalIds.map((id) => playlist.items.find((item) => item.id === id)).filter((item): item is BgmPlaylist["items"][number] => Boolean(item)) } : playlist));
    dragRef.current = null;
    setDraggingItemId(null);
  }

  return <section className="bgm-manager">
    <div className="bgm-manager-heading"><h3><Music size={16} />BGM 보관함</h3><button className="button" onClick={() => fileInput.current?.click()} disabled={pending}><UploadIcon size={14} />MP3 여러 곡 업로드</button><input ref={fileInput} className="visually-hidden" type="file" accept="audio/mpeg,.mp3" multiple onChange={(event) => { chooseUploadFiles(event.target.files); event.target.value = ""; }} /></div>
    <button className="button" disabled={pending} onClick={() => setDialog({ heading: "YouTube BGM 추가", initialUrl: "", onSave: (values) => saveDetails("/api/bgm/library", "POST", values) })}><Plus size={14} />YouTube 추가</button>
    {loadError && <p className="error" role="alert">{loadError}</p>}
    <div className="bgm-library-list">{items.map((item) => <div key={item.id}><div className="bgm-track-label"><span>{item.custom_title || item.asset.canonical_title}</span><small title={item.asset.original_filename ?? undefined}>{originalFileLabel(item.asset)}</small></div><button onClick={() => rename(item)} title="BGM 수정" aria-label={`${item.custom_title || item.asset.canonical_title} 수정`}><Pencil size={13} /></button><button onClick={() => void remove(item)} title="보관함에서 제거" aria-label={`${item.custom_title || item.asset.canonical_title} 제거`}><Trash2 size={13} /></button></div>)}{!items.length && <p>아직 저장한 BGM이 없습니다.</p>}</div>
    <div className="bgm-manager-heading"><h3><ListMusic size={16} />플레이리스트</h3><button className="button" onClick={createPlaylist}><Plus size={14} />새 플레이리스트</button></div>
    <div className="bgm-playlist-list">{playlists.map((playlist) => {
      const isCollapsed = collapsed.has(playlist.id);
      return <section key={playlist.id}>
        <header><button onClick={() => togglePlaylist(playlist.id)} title={isCollapsed ? "펼치기" : "접기"} aria-label={`${playlist.title} ${isCollapsed ? "펼치기" : "접기"}`} aria-expanded={!isCollapsed}>{isCollapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button><strong>{playlist.title}</strong><small>{playlist.items.length}곡{playlist.source_page_id ? " · 페이지 자동 연동" : ""}</small><button onClick={() => setPicking(playlist)} title="보관함에서 여러 곡 추가" aria-label={`${playlist.title}에 곡 추가`}><Plus size={13} /></button><button onClick={() => renamePlaylist(playlist)} title="플레이리스트 이름 수정" aria-label={`${playlist.title} 이름 수정`}><Pencil size={13} /></button><button onClick={() => void deletePlaylist(playlist)} title="플레이리스트 삭제" aria-label={`${playlist.title} 삭제`}><Trash2 size={13} /></button></header>
        {!isCollapsed && <div className="bgm-playlist-tracks">{playlist.items.map((item) => <div key={item.id} className={draggingItemId === item.id ? "is-dragging" : ""} onDragOver={(event) => previewDrag(event, playlist.id, item.id)} onDrop={finishDrop}><button className="bgm-track-drag" draggable onDragStart={(event) => beginDrag(event, playlist, item.id)} onDragEnd={cancelDrag} title="끌어서 순서 변경" aria-label={`${item.custom_title || item.asset.canonical_title} 순서 변경`}><GripVertical size={14} /></button><div className="bgm-track-label"><span>{item.custom_title || item.asset.canonical_title}</span><small title={item.asset.original_filename ?? undefined}>{originalFileLabel(item.asset)}</small></div><button onClick={() => renamePlaylistItem(playlist, item.id, item.custom_title || item.asset.canonical_title)} title="이 플레이리스트에서 이름 변경" aria-label={`${item.custom_title || item.asset.canonical_title} 이름 변경`}><Pencil size={12} /></button><button onClick={() => void removePlaylistItem(playlist, item.id)} title="플레이리스트에서 제거" aria-label={`${item.custom_title || item.asset.canonical_title} 제거`}><Trash2 size={12} /></button></div>)}{!playlist.items.length && <p className="bgm-empty-playlist">곡 추가 버튼을 눌러 보관함의 곡을 담아보세요.</p>}</div>}
      </section>;
    })}{!playlists.length && <p>아직 만든 플레이리스트가 없습니다.</p>}</div>
    {uploadFiles.length > 0 && <BgmUploadDialog key={uploadFiles.map((file) => `${file.name}:${file.lastModified}`).join("|")} files={uploadFiles} onUpload={upload} onChanged={load} onClose={() => setUploadFiles([])} />}
    {dialog && <BgmDetailsDialog {...dialog} onClose={() => setDialog(null)} />}
    {picking && <BgmTrackPickerDialog title={picking.title} items={items.map((item) => ({ id: item.bgm_asset_id, title: item.custom_title || item.asset.canonical_title, source: originalFileLabel(item.asset), alreadyAdded: picking.items.some((playlistItem) => playlistItem.bgm_asset_id === item.bgm_asset_id) }))} onSave={(assetIds) => addPlaylistItems(picking, assetIds)} onClose={() => setPicking(null)} />}
  </section>;
}
