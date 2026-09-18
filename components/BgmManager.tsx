"use client";

import { ChevronDown, ChevronUp, ListMusic, Music, Pencil, Plus, Trash2, Upload as UploadIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { BgmLibraryItem, BgmPlaylist } from "@/lib/types";
import { BgmUploadDialog } from "@/components/BgmUploadDialog";
import { BgmDetailsDialog, BgmTrackPickerDialog } from "@/components/BgmDetailsDialog";

export function BgmManager() {
  const [items, setItems] = useState<BgmLibraryItem[]>([]);
  const [playlists, setPlaylists] = useState<BgmPlaylist[]>([]);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [dialog, setDialog] = useState<Omit<Parameters<typeof BgmDetailsDialog>[0], "onClose"> | null>(null);
  const [picking, setPicking] = useState<BgmPlaylist | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const [libraryResponse, playlistResponse] = await Promise.all([fetch("/api/bgm/library", { cache: "no-store" }), fetch("/api/bgm/playlists", { cache: "no-store" })]);
    const [library, playlist] = await Promise.all([libraryResponse.json(), playlistResponse.json()]);
    if (!libraryResponse.ok || !playlistResponse.ok) throw new Error(library.error ?? playlist.error ?? "BGM 보관함을 불러오지 못했습니다.");
    setLoadError("");
    setItems(library.items ?? []); setPlaylists(playlist.playlists ?? []);
  }, []);
  useEffect(() => { void load().catch((error) => setLoadError(error instanceof Error ? error.message : "목록 오류")); }, [load]);

  async function saveDetails(path: string, method: string, body: object) {
    setPending(true);
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "BGM을 저장하지 못했습니다.");
      if (result.sourceUpdated) window.dispatchEvent(new CustomEvent("bgm-source-updated", { detail: { assetId: result.assetId } }));
      await load();
    }
    finally { setPending(false); }
  }
  async function upload(file: File, title: string) {
    if (!/\.mp3$/i.test(file.name) || file.size <= 0 || file.size > 25_000_000) throw new Error("25MB 이하 MP3 파일만 사용할 수 있습니다.");
    setPending(true);
    try {
      const prepare = await fetch("/api/bgm/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, mimeType: "audio/mpeg", byteSize: file.size }) });
      const target = await prepare.json().catch(() => ({})); if (!prepare.ok) throw new Error(target.error ?? "업로드를 준비하지 못했습니다.");
      const { error } = await createSupabaseBrowserClient().storage.from("bgm-audio").uploadToSignedUrl(target.path, target.token, file, { contentType: "audio/mpeg" });
      if (error) throw new Error("MP3를 업로드하지 못했습니다.");
      const confirm = await fetch("/api/bgm/upload", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: target.assetId }) });
      const result = await confirm.json().catch(() => ({})); if (!confirm.ok) throw new Error(result.error ?? "업로드를 확정하지 못했습니다.");
      await load();
      setUploadFile(null);
    } finally { setPending(false); }
  }
  function rename(item: BgmLibraryItem) {
    setDialog({ heading: "BGM 수정", initialTitle: item.custom_title || item.asset.canonical_title, ...(item.asset.source_type === "youtube" ? { initialUrl: `https://www.youtube.com/watch?v=${item.asset.youtube_video_id}`, canEditUrl: Boolean(item.can_edit_source) } : {}), description: "이름은 내 보관함에서만 변경됩니다. YouTube 링크를 바꾸면 같은 곡을 사용하는 모든 페이지와 플레이리스트의 재생 원본이 바뀝니다. 재생 중인 곡은 멈추며 다음 재생부터 반영됩니다.", onSave: (values) => saveDetails("/api/bgm/library", "PATCH", { id: item.id, ...values }) });
  }
  async function remove(item: BgmLibraryItem) {
    if (!window.confirm("개인 BGM 보관함에서 제거할까요? 페이지와 다른 사용자의 참조는 유지됩니다.")) return;
    const response = await fetch(`/api/bgm/library?id=${item.id}`, { method: "DELETE" }); if (!response.ok) return window.alert("BGM을 제거하지 못했습니다."); await load();
  }
  function createPlaylist() {
    setDialog({ heading: "새 플레이리스트", onSave: (values) => saveDetails("/api/bgm/playlists", "POST", values) });
  }
  function renamePlaylist(playlist: BgmPlaylist) {
    setDialog({ heading: "플레이리스트 이름 수정", initialTitle: playlist.title, onSave: (values) => saveDetails("/api/bgm/playlists", "PATCH", { id: playlist.id, ...values }) });
  }
  async function deletePlaylist(playlist: BgmPlaylist) {
    if (!window.confirm("플레이리스트를 삭제할까요? BGM 보관함과 페이지 연결은 유지됩니다.")) return;
    const response = await fetch(`/api/bgm/playlists?id=${playlist.id}`, { method: "DELETE" }); if (!response.ok) return window.alert("플레이리스트를 삭제하지 못했습니다."); await load();
  }
  function addToPlaylist(playlist: BgmPlaylist) {
    setPicking(playlist);
  }
  async function removePlaylistItem(playlist: BgmPlaylist, itemId: string) {
    const response = await fetch(`/api/bgm/playlists/items?playlistId=${playlist.id}&id=${itemId}`, { method: "DELETE" }); if (!response.ok) return window.alert("곡을 제거하지 못했습니다."); await load();
  }
  function renamePlaylistItem(playlist: BgmPlaylist, itemId: string, currentTitle: string) {
    setDialog({ heading: "플레이리스트 곡 이름 수정", initialTitle: currentTitle, onSave: (values) => saveDetails("/api/bgm/playlists/items", "PATCH", { playlistId: playlist.id, id: itemId, customTitle: values.title }) });
  }
  async function movePlaylistItem(playlist: BgmPlaylist, itemId: string, offset: number) {
    const index = playlist.items.findIndex((item) => item.id === itemId); const target = index + offset;
    if (index < 0 || target < 0 || target >= playlist.items.length) return;
    const reordered = [...playlist.items]; const [moving] = reordered.splice(index, 1); reordered.splice(target, 0, moving);
    const response = await fetch("/api/bgm/playlists/items", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ playlistId: playlist.id, itemIds: reordered.map((item) => item.id) }) }); if (!response.ok) return window.alert("곡 순서를 바꾸지 못했습니다."); await load();
  }

  return <section className="bgm-manager"><div className="bgm-manager-heading"><h3><Music size={16} />BGM 보관함</h3><button className="button" onClick={() => fileInput.current?.click()} disabled={pending}><UploadIcon size={14} />MP3 업로드</button><input ref={fileInput} className="visually-hidden" type="file" accept="audio/mpeg,.mp3" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) setUploadFile(file); }} /></div><button className="button" disabled={pending} onClick={() => setDialog({ heading: "YouTube BGM 추가", initialUrl: "", onSave: (values) => saveDetails("/api/bgm/library", "POST", values) })}><Plus size={14} />YouTube 추가</button>{loadError && <p className="error" role="alert">{loadError}</p>}<div className="bgm-library-list">{items.map((item) => <div key={item.id}><span>{item.custom_title || item.asset.canonical_title}<small>{item.asset.source_type === "youtube" ? "YouTube" : "MP3"}</small></span><button onClick={() => void rename(item)} title="BGM 수정"><Pencil size={13} /></button><button onClick={() => void remove(item)} title="보관함에서 제거"><Trash2 size={13} /></button></div>)}{!items.length && <p>아직 저장한 BGM이 없습니다.</p>}</div><div className="bgm-manager-heading"><h3><ListMusic size={16} />플레이리스트</h3><button className="button" onClick={() => void createPlaylist()}><Plus size={14} />새 플레이리스트</button></div><div className="bgm-playlist-list">{playlists.map((playlist) => <section key={playlist.id}><header><strong>{playlist.title}</strong>{playlist.source_page_id && <small>페이지와 자동 연동</small>}<button onClick={() => void addToPlaylist(playlist)}><Plus size={13} /></button><button onClick={() => void renamePlaylist(playlist)}><Pencil size={13} /></button><button onClick={() => void deletePlaylist(playlist)}><Trash2 size={13} /></button></header>{playlist.items.map((item) => <div key={item.id}><span>{item.custom_title || item.asset.canonical_title}</span><button onClick={() => void movePlaylistItem(playlist, item.id, -1)} title="위로"><ChevronUp size={12} /></button><button onClick={() => void movePlaylistItem(playlist, item.id, 1)} title="아래로"><ChevronDown size={12} /></button><button onClick={() => void renamePlaylistItem(playlist, item.id, item.custom_title || item.asset.canonical_title)} title="플레이리스트 별칭"><Pencil size={12} /></button><button onClick={() => void removePlaylistItem(playlist, item.id)} title="플레이리스트에서 제거"><Trash2 size={12} /></button></div>)}</section>)}</div>{uploadFile && <BgmUploadDialog key={uploadFile.name + uploadFile.lastModified} file={uploadFile} pending={pending} onUpload={(title) => upload(uploadFile, title)} onClose={() => setUploadFile(null)} />}{dialog && <BgmDetailsDialog {...dialog} onClose={() => setDialog(null)} />}{picking && <BgmTrackPickerDialog title={picking.title} items={items.map((item) => ({ id: item.bgm_asset_id, title: item.custom_title || item.asset.canonical_title }))} onSave={(assetId) => saveDetails("/api/bgm/playlists/items", "POST", { playlistId: picking.id, assetId })} onClose={() => setPicking(null)} />}</section>;
}
