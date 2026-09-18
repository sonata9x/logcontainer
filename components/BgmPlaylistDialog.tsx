"use client";

import { MoreHorizontal, Music, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useEscapeClose } from "@/lib/use-escape-close";

type Props = { pageId: string; pageTitle: string; publicationToken?: string; onClose: () => void };

export function BgmPlaylistDialog({ pageId, pageTitle, publicationToken, onClose }: Props) {
  const [playlists, setPlaylists] = useState<Array<{ id: string; title: string }>>([]);
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState(pageTitle);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string | null>(null);
  useEscapeClose(onClose, pending);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/bgm/playlists", { cache: "no-store" });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(response.status === 401 ? "로그인한 뒤 내 플레이리스트에 담을 수 있습니다." : body.error ?? "플레이리스트를 불러오지 못했습니다.");
        if (active) { setPlaylists(body.playlists ?? []); setLoading(false); }
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "플레이리스트를 불러오지 못했습니다."); }
    })();
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (pending || loading) return;
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/pages/${pageId}/bgm/playlist`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, playlistId: target || undefined, publicationToken })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "로그 BGM을 담지 못했습니다.");
      setResult(`${body.playlist.title}에 ${body.addedCount}곡을 추가했습니다. 이미 담긴 곡 ${body.existingCount}곡은 중복 추가하지 않았습니다.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "로그 BGM을 담지 못했습니다."); }
    finally { setPending(false); }
  }
  if (typeof document === "undefined") return null;
  return createPortal(<div className="modal-backdrop" onMouseDown={() => !pending && onClose()}><section className="modal-card bgm-playlist-dialog" role="dialog" aria-modal="true" aria-label="로그 BGM 전체 담기" onMouseDown={(event) => event.stopPropagation()}>
    <button className="modal-close" aria-label="플레이리스트 창 닫기" onClick={onClose} disabled={pending}><X size={18} /></button>
    <h2>로그 BGM 전체 담기</h2><p>대기 BGM과 모든 로그 블록의 현재 곡을 내 플레이리스트에 복사합니다. 같은 곡은 한 번만 담습니다. 새 플레이리스트는 자동 연동되지 않으며, 기존 플레이리스트의 연동 설정은 유지됩니다.</p>
    {result ? <><p role="status">{result}</p><div className="modal-actions"><button className="button" onClick={onClose}>닫기</button></div></> : <form onSubmit={save}>
      <label className="field">플레이리스트<select value={target} onChange={(event) => setTarget(event.target.value)} disabled={loading || pending}><option value="">새 플레이리스트</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title}</option>)}</select></label>
      {!target && <label className="field">새 플레이리스트 제목<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} disabled={pending || loading} /></label>}
      {error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button" onClick={onClose} disabled={pending}>취소</button><button className="button button-primary" disabled={loading || pending || (!target && !title.trim())}>{pending ? "담는 중…" : "전체 곡 담기"}</button></div>
    </form>}
  </section></div>, document.body);
}

export function PublicBgmMenu({ pageId, pageTitle, publicationToken }: Omit<Props, "onClose">) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  useEscapeClose(() => setMenuOpen(false), !menuOpen || dialogOpen);
  return <><div className="toolbar-overflow"><button className="button" aria-label="로그 메뉴" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><MoreHorizontal size={16} /></button>{menuOpen && <div className="toolbar-overflow-menu"><button disabled={!pageId} onClick={() => { setDialogOpen(true); setMenuOpen(false); }}><Music size={14} />로그 BGM 전체 담기</button></div>}</div>{dialogOpen && <BgmPlaylistDialog pageId={pageId} pageTitle={pageTitle} publicationToken={publicationToken} onClose={() => setDialogOpen(false)} />}</>;
}
