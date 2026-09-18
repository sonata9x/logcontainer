"use client";

import { RefreshCw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { BGM_USAGE_FILTERS, bgmUsageLabel, formatBgmBytes, recentBgmUpload, type AdminBgmAsset, type BgmUsageFilter } from "@/lib/bgm-admin";
import { useEscapeClose } from "@/lib/use-escape-close";

type Inventory = { assets: AdminBgmAsset[]; total: number; totalBytes: number; matching: number };

export function AdminBgmPanel() {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [usage, setUsage] = useState<BgmUsageFilter>("all");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<AdminBgmAsset | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const close = () => { if (!pending) { setSelected(null); setConfirmation(""); } };
  useEscapeClose(close, pending || !selected);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(""); setInventory(null);
    try {
      const response = await fetch(`/api/admin/bgm?offset=${offset}&search=${encodeURIComponent(query)}&usage=${usage}`, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "목록을 불러오지 못했습니다.");
      if (!signal?.aborted) setInventory(result);
    } catch (error) { if (!signal?.aborted) setError(error instanceof Error ? error.message : "목록 오류"); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [offset, query, usage]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  async function remove(event: FormEvent) {
    event.preventDefault();
    if (!selected || confirmation !== selected.title || pending) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/admin/bgm", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: selected.id, confirm: "PERMANENTLY_DELETE" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "삭제하지 못했습니다.");
      setSelected(null); setConfirmation("");
      if (offset > 0 && inventory?.assets.length === 1) setOffset(offset - 100);
      else await load();
    } catch (error) { setError(error instanceof Error ? error.message : "삭제 오류"); }
    finally { setPending(false); }
  }

  return <section className="admin-accounts admin-bgm"><header><h1>BGM 관리</h1><p>사이트 전체의 MP3·YouTube BGM과 사용 위치를 확인합니다.</p></header>
    <div className="admin-bgm-summary"><strong>{inventory?.total ?? "…"}곡</strong><span>MP3 합계 {formatBgmBytes(inventory?.totalBytes ?? 0)}</span><small>DB에 등록된 원본 파일 크기 기준 · 미완료 업로드 포함</small></div>
    <form className="admin-bgm-search" onSubmit={(event) => { event.preventDefault(); setOffset(0); setQuery(search.trim()); }}><input aria-label="BGM 제목 검색" placeholder="제목으로 검색" value={search} onChange={(event) => setSearch(event.target.value)} maxLength={200} /><button className="button" disabled={loading || pending}><Search size={15} />검색</button><button className="button" type="button" aria-label="목록 새로고침" onClick={() => void load()} disabled={loading || pending}><RefreshCw size={15} /></button></form>
    {error && !selected && <p className="error" role="alert">{error}</p>}{loading && <p className="muted" role="status">불러오는 중…</p>}
    <div className="admin-bgm-filters" role="group" aria-label="BGM 사용 상태 필터">{BGM_USAGE_FILTERS.map((filter) => <button className="button" key={filter.value} aria-pressed={usage === filter.value} onClick={() => { setOffset(0); setUsage(filter.value); }} disabled={pending}>{filter.label}</button>)}</div>{usage !== "all" && <p className="muted admin-bgm-filter-note">로그 미사용은 페이지 연결이 없는 곡입니다. 휴지통의 페이지·블록 연결도 사용 중으로 간주합니다.</p>}
    <div className="admin-bgm-list">{!loading && inventory?.assets.map((asset) => <article key={asset.id}><div className="admin-bgm-heading"><div><div className="admin-bgm-title-line"><strong>{asset.title}</strong><span className="bgm-usage-badge">{bgmUsageLabel(asset)}</span>{recentBgmUpload(asset) && <small className="bgm-protection-badge">업로드 후 24시간 동안 영구 삭제 보호</small>}</div><small>{asset.sourceType === "upload" ? `MP3 · ${formatBgmBytes(asset.byteSize)}` : "YouTube · Storage 사용 없음"} · {asset.owner}</small></div><button className="button button-danger" aria-label={`${asset.title} 영구 삭제`} onClick={() => { setSelected(asset); setConfirmation(""); setError(""); }} disabled={pending || recentBgmUpload(asset)}><Trash2 size={15} /></button></div>
      <details><summary>사용 위치 · 페이지 {asset.pages.length} / 플레이리스트 {asset.playlists.length} / 보관함 {asset.libraries.length}</summary><ul>{asset.pages.map((page, i) => <li key={`page-${i}`}>페이지: {page.title} · {page.role === "waiting" ? "대기 BGM" : "블록 BGM"}{page.deleted || page.entryDeleted ? " (휴지통)" : ""}</li>)}{asset.playlists.map((playlist, i) => <li key={`playlist-${i}`}>플레이리스트: {playlist.title} · {playlist.owner}</li>)}{asset.libraries.map((owner, i) => <li key={`library-${i}`}>보관함: {owner}</li>)}</ul>{!asset.pages.length && !asset.playlists.length && !asset.libraries.length && <p className="muted">등록된 위치가 없습니다.</p>}</details></article>)}{!loading && inventory?.matching === 0 && <p className="muted">표시할 BGM이 없습니다.</p>}</div>
    <div className="admin-bgm-pagination"><button className="button" disabled={!offset || loading || pending} onClick={() => setOffset(Math.max(0, offset - 100))}>이전</button><span>{Math.floor(offset / 100) + 1} / {Math.max(1, Math.ceil((inventory?.matching ?? 0) / 100))}</span><button className="button" disabled={offset + 100 >= (inventory?.matching ?? 0) || loading || pending} onClick={() => setOffset(offset + 100)}>다음</button></div>
    {selected && createPortal(<div className="modal-backdrop" onMouseDown={close}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-bgm-title" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" aria-label="닫기" onClick={close} disabled={pending}><X size={17} /></button><h2 id="delete-bgm-title">BGM 영구 삭제</h2><p><strong>{selected.title}</strong>의 원본 파일과 모든 사용자의 페이지·플레이리스트·보관함 연결을 삭제합니다. 되돌릴 수 없습니다.</p><p>페이지 {selected.pages.length} · 플레이리스트 {selected.playlists.length} · 보관함 {selected.libraries.length}</p><form onSubmit={remove}><label className="field">확인을 위해 곡 제목을 그대로 입력해주세요.<input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={pending} autoComplete="off" /></label>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="button" type="button" onClick={close} disabled={pending}>취소</button><button className="button button-danger-solid" disabled={pending || confirmation !== selected.title}>{pending ? "삭제 중…" : "영구 삭제"}</button></div></form></section></div>, document.body)}
  </section>;
}
