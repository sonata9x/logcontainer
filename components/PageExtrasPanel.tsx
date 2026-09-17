/* eslint-disable @next/next/no-img-element -- private signed URLs expire and are supplied by the API */
"use client";

import { ImagePlus, Music, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BgmLibraryAddButton, BgmPlayButton } from "@/components/BgmPlayer";
import { LOG_FONT_OPTIONS, SESSION_CARD_MAX_BYTES, SESSION_CARD_TYPES } from "@/lib/page-extras";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { BgmLibraryItem, BgmPlaylist, LogFontFamily, PageBgmItem, PageExtras } from "@/lib/types";
import { BgmSourceCreator } from "@/components/BgmSourceCreator";

export function BgmAttachDialog({ pageId, entryId, current, onChange, onClose }: { pageId: string; entryId: string; current: PageBgmItem | null; onChange: (item: PageBgmItem | null) => void; onClose: () => void }) {
  const [library, setLibrary] = useState<BgmLibraryItem[]>([]);
  const [playlists, setPlaylists] = useState<BgmPlaylist[]>([]);
  const [pending, setPending] = useState(false);
  async function reload() { const [libraryResult, playlistResult] = await Promise.all([fetch("/api/bgm/library", { cache: "no-store" }).then((response) => response.json()), fetch("/api/bgm/playlists", { cache: "no-store" }).then((response) => response.json())]); setLibrary(libraryResult.items ?? []); setPlaylists(playlistResult.playlists ?? []); }
  useEffect(() => { void reload(); }, []);
  async function choose(assetId: string) {
    if (current?.bgm_asset_id === assetId) return onClose();
    setPending(true);
    const response = await fetch(`/api/pages/${pageId}/bgm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId, role: "entry", entryId }) });
    const result = await response.json().catch(() => ({})); setPending(false);
    if (!response.ok) return window.alert(result.error ?? "메시지 BGM을 연결하지 못했습니다.");
    onChange(result.item); onClose();
  }
  async function remove() {
    if (!current) return;
    setPending(true); const response = await fetch(`/api/pages/${pageId}/bgm?itemId=${current.id}`, { method: "DELETE" }); setPending(false);
    if (!response.ok) return window.alert("메시지 BGM을 제거하지 못했습니다.");
    onChange(null); onClose();
  }
  return typeof document === "undefined" ? null : createPortal(<div className="modal-backdrop" onMouseDown={() => !pending && onClose()}><section className="modal-card bgm-attach-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={onClose}><X size={18} /></button><h2>메시지 BGM</h2><BgmSourceCreator onCreated={reload} /><h3>내 BGM</h3><div className="bgm-picker-list">{library.length ? library.map((item) => <button className="button" key={item.id} onClick={() => void choose(item.bgm_asset_id)} disabled={pending}>{item.custom_title || item.asset.canonical_title}</button>) : <p>설정의 BGM 보관함에 BGM을 먼저 추가해주세요.</p>}</div>{playlists.length > 0 && <><h3>플레이리스트</h3><div className="bgm-picker-playlists">{playlists.map((playlist) => <details key={playlist.id}><summary>{playlist.title}</summary><div className="bgm-picker-list">{playlist.items.map((item) => <button className="button" key={item.id} onClick={() => void choose(item.bgm_asset_id)} disabled={pending}>{item.custom_title || item.asset.canonical_title}</button>)}</div></details>)}</div></>}<div className="modal-actions">{current && <button className="button button-danger" onClick={() => void remove()} disabled={pending}>연결 해제</button>}<button className="button" onClick={onClose}>닫기</button></div></section></div>, document.body);
}

export function PageExtrasDisplay({ extras, waitingBgm, publicationToken }: { extras: PageExtras | null; waitingBgm: PageBgmItem[]; publicationToken?: string }) {
  if (!extras?.sessionCardUrl && !extras?.overview && !waitingBgm.length) return null;
  return <section className="page-extras" data-font={extras?.fontFamily ?? "pretendard"}>{extras?.sessionCardUrl && <img className="session-card" src={extras.sessionCardUrl} alt="세션 카드" />}{extras?.overview && <div className="page-overview">{extras.overview}</div>}{waitingBgm.length > 0 && <div className="waiting-bgm"><Music size={14} /><span>대기 BGM</span>{waitingBgm.map((item) => <span key={item.id}><BgmPlayButton item={item} />{item.custom_title || item.asset.canonical_title}{publicationToken && <BgmLibraryAddButton item={item} publicationToken={publicationToken} />}</span>)}</div>}</section>;
}

export function PageExtrasEditor({ pageId, pageTitle, extras, bgmItems, onChange }: { pageId: string; pageTitle?: string; extras: PageExtras | null; bgmItems: PageBgmItem[]; onChange: (extras: PageExtras, bgmItems?: PageBgmItem[]) => void }) {
  const [open, setOpen] = useState(false);
  const [overview, setOverview] = useState(extras?.overview ?? "");
  const [fontFamily, setFontFamily] = useState<LogFontFamily>(extras?.fontFamily ?? "pretendard");
  const [library, setLibrary] = useState<BgmLibraryItem[]>([]);
  const [waitingPlaylists, setWaitingPlaylists] = useState<BgmPlaylist[]>([]);
  const [pending, setPending] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setOverview(extras?.overview ?? ""); setFontFamily(extras?.fontFamily ?? "pretendard"); }, [extras]);

  async function loadLibrary() {
    const [response, playlistResponse] = await Promise.all([fetch("/api/bgm/library", { cache: "no-store" }), fetch("/api/bgm/playlists", { cache: "no-store" })]);
    const [result, playlistResult] = await Promise.all([response.json().catch(() => ({})), playlistResponse.json().catch(() => ({}))]);
    if (response.ok) setLibrary(result.items ?? []);
    if (playlistResponse.ok) setWaitingPlaylists(playlistResult.playlists ?? []);
  }
  async function save() {
    setPending(true);
    try {
      const response = await fetch(`/api/pages/${pageId}/extras`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ overview, fontFamily }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "페이지 설정을 저장하지 못했습니다.");
      onChange(result.extras); setOpen(false);
    } catch (error) { window.alert(error instanceof Error ? error.message : "페이지 설정을 저장하지 못했습니다."); }
    finally { setPending(false); }
  }
  async function uploadCard(file: File) {
    if (!SESSION_CARD_TYPES.has(file.type) || file.size <= 0 || file.size > SESSION_CARD_MAX_BYTES) return window.alert("10MB 이하 PNG, JPG, GIF, WebP 이미지만 사용할 수 있습니다.");
    setPending(true);
    try {
      const prepare = await fetch(`/api/pages/${pageId}/session-card`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mimeType: file.type, byteSize: file.size }) });
      const target = await prepare.json().catch(() => ({}));
      if (!prepare.ok) throw new Error(target.error ?? "업로드를 준비하지 못했습니다.");
      const { error } = await createSupabaseBrowserClient().storage.from("session-cards").uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });
      if (error) throw new Error("이미지를 업로드하지 못했습니다.");
      const confirm = await fetch(`/api/pages/${pageId}/session-card`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: target.path, mimeType: file.type, byteSize: file.size }) });
      if (!confirm.ok) throw new Error("세션 카드를 저장하지 못했습니다.");
      const refreshed = await fetch(`/api/pages/${pageId}/extras`, { cache: "no-store" }).then((value) => value.json());
      onChange(refreshed.extras);
    } catch (error) { window.alert(error instanceof Error ? error.message : "세션 카드를 저장하지 못했습니다."); }
    finally { setPending(false); }
  }
  async function removeCard() {
    if (!window.confirm("세션 카드를 삭제할까요?")) return;
    const response = await fetch(`/api/pages/${pageId}/session-card`, { method: "DELETE" });
    if (!response.ok) return window.alert("세션 카드를 삭제하지 못했습니다.");
    const refreshed = await fetch(`/api/pages/${pageId}/extras`, { cache: "no-store" }).then((value) => value.json()); onChange(refreshed.extras);
  }
  async function addWaiting(assetId: string) {
    if (pending || bgmItems.some((item) => item.role === "waiting" && item.bgm_asset_id === assetId)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/pages/${pageId}/bgm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId, role: "waiting" }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "대기 BGM을 변경하지 못했습니다.");
      onChange(extras ?? { overview: null, fontFamily: "pretendard", sessionCardUrl: null, sessionCardMime: null, sessionCardSize: null }, [...bgmItems.filter((item) => item.role !== "waiting"), result.item]);
    } catch (error) { window.alert(error instanceof Error ? error.message : "대기 BGM을 변경하지 못했습니다."); }
    finally { setPending(false); }
  }
  async function removeWaiting(item: PageBgmItem) {
    const response = await fetch(`/api/pages/${pageId}/bgm?itemId=${item.id}`, { method: "DELETE" });
    if (!response.ok) return window.alert("대기 BGM을 제거하지 못했습니다.");
    onChange(extras ?? { overview: null, fontFamily: "pretendard", sessionCardUrl: null, sessionCardMime: null, sessionCardSize: null }, bgmItems.filter((value) => value.id !== item.id));
  }
  async function createLinkedPlaylist() {
    const title = window.prompt("페이지와 연동할 플레이리스트 이름", pageTitle || "새 플레이리스트")?.trim();
    if (!title) return;
    const response = await fetch(`/api/pages/${pageId}/bgm/playlist`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    const result = await response.json().catch(() => ({}));
    window.alert(response.ok ? "현재 BGM을 담은 연동 플레이리스트를 만들었습니다. 이후 이 페이지에 추가한 BGM도 자동 반영됩니다." : result.error ?? "플레이리스트를 만들지 못했습니다.");
  }

  return <><button className="button" onClick={() => { setOpen(true); void loadLibrary(); }}><Settings2 size={14} />페이지 꾸미기</button>{open && typeof document !== "undefined" && createPortal(<div className="modal-backdrop" onMouseDown={() => !pending && setOpen(false)}><section className="modal-card page-extras-editor" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setOpen(false)}><X size={18} /></button><h2>페이지 꾸미기</h2><BgmSourceCreator onCreated={loadLibrary} /><label className="field">본문 글꼴<select value={fontFamily} onChange={(event) => setFontFamily(event.target.value as LogFontFamily)}>{LOG_FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label className="field">페이지 개요<textarea value={overview} onChange={(event) => setOverview(event.target.value)} maxLength={20000} placeholder="세션 소개나 안내를 입력하세요." /></label><div className="page-extra-card-row"><button className="button" onClick={() => imageInput.current?.click()} disabled={pending}><ImagePlus size={14} />세션 카드 {extras?.sessionCardUrl ? "교체" : "추가"}</button>{extras?.sessionCardUrl && <button className="button button-danger" onClick={() => void removeCard()}><Trash2 size={14} />삭제</button>}<input ref={imageInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void uploadCard(file); }} /></div><div className="field"><span>현재 대기 BGM</span><div className="bgm-current-list">{bgmItems.filter((item) => item.role === "waiting").map((item) => <span key={item.id}>{item.custom_title || item.asset.canonical_title}<button onClick={() => void removeWaiting(item)} aria-label="대기 BGM 제거"><Trash2 size={12} /></button></span>)}</div><span>대기 BGM 선택 · 한 곡만 설정됩니다</span><small>다른 곡을 선택하면 현재 대기 BGM을 교체합니다.</small><div className="bgm-picker-list">{library.length ? library.map((item) => <button className="button" key={item.id} onClick={() => void addWaiting(item.bgm_asset_id)} disabled={pending}>{item.custom_title || item.asset.canonical_title}</button>) : <small>설정의 BGM 보관함에서 MP3 또는 YouTube BGM을 먼저 추가하세요.</small>}</div>{waitingPlaylists.length > 0 && <div className="bgm-picker-playlists">{waitingPlaylists.map((playlist) => <details key={playlist.id}><summary>{playlist.title}</summary><div className="bgm-picker-list">{playlist.items.map((item) => <button className="button" key={item.id} onClick={() => void addWaiting(item.bgm_asset_id)} disabled={pending}>{item.custom_title || item.asset.canonical_title}</button>)}</div></details>)}</div>}</div><button className="button" onClick={() => void createLinkedPlaylist()}><Music size={14} />현재 페이지 BGM으로 연동 플레이리스트 만들기</button><div className="modal-actions"><button className="button" onClick={() => setOpen(false)}>취소</button><button className="button button-primary" onClick={() => void save()} disabled={pending}>{pending ? "저장 중…" : "저장"}</button></div></section></div>, document.body)}</>;
}
