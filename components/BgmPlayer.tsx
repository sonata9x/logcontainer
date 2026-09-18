"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Music, Pause, Play, Volume2, X } from "lucide-react";
import type { PageBgmItem } from "@/lib/types";
import { displayBgmTitle } from "@/lib/bgm";

type Access = { pageId: string; publicationToken?: string; guestToken?: string };
type PlayerContextValue = { currentId: string | null; play: (item: PageBgmItem) => Promise<void>; stop: () => void };
const PlayerContext = createContext<PlayerContextValue | null>(null);

export function useBgmPlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error("BgmPlayerProvider is required");
  return value;
}

export function BgmPlayerProvider({ access, children }: { access: Access; children: ReactNode }) {
  const audio = useRef<HTMLAudioElement>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const [current, setCurrent] = useState<PageBgmItem | null>(null);
  const [source, setSource] = useState<{ type: "upload"; url: string } | { type: "youtube"; videoId: string } | null>(null);
  const [volume, setVolume] = useState(70);
  const [playing, setPlaying] = useState(false);

  const stop = useCallback(() => {
    audio.current?.pause();
    iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "stopVideo", args: [] }), "https://www.youtube.com");
    setCurrent(null); setSource(null); setPlaying(false);
  }, []);

  const play = useCallback(async (item: PageBgmItem) => {
    if (current?.id === item.id && playing) {
      audio.current?.pause();
      iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), "https://www.youtube.com");
      setPlaying(false); return;
    }
    if (current?.id === item.id && source?.type === "upload") {
      await audio.current?.play();
      setPlaying(true); return;
    }
    stop();
    const params = new URLSearchParams({ assetId: item.bgm_asset_id, pageId: access.pageId });
    if (access.publicationToken) params.set("publicationToken", access.publicationToken);
    if (access.guestToken) params.set("guestToken", access.guestToken);
    const response = await fetch(`/api/bgm/play?${params}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return window.alert(result.error ?? "BGM을 재생하지 못했습니다.");
    setCurrent(item);
    setSource(result.sourceType === "youtube" ? { type: "youtube", videoId: result.videoId } : { type: "upload", url: result.url });
    setPlaying(true);
  }, [access.guestToken, access.pageId, access.publicationToken, current?.id, playing, source, stop]);

  useEffect(() => {
    const changed = (event: Event) => { if ((event as CustomEvent<{ assetId: string }>).detail?.assetId === current?.bgm_asset_id) stop(); };
    window.addEventListener("bgm-source-updated", changed);
    return () => window.removeEventListener("bgm-source-updated", changed);
  }, [current?.bgm_asset_id, stop]);

  useEffect(() => {
    if (source?.type !== "upload" || !audio.current) return;
    audio.current.volume = volume / 100;
    void audio.current.play().catch(() => setPlaying(false));
  }, [source, volume]);
  useEffect(() => {
    if (source?.type !== "youtube") return;
    const timer = window.setTimeout(() => iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [volume] }), "https://www.youtube.com"), 500);
    return () => window.clearTimeout(timer);
  }, [source, volume]);

  return <PlayerContext.Provider value={{ currentId: current?.id ?? null, play, stop }}>
    {children}
    {source?.type === "upload" && <audio ref={audio} src={source.url} onEnded={stop} />}
    {source?.type === "youtube" && <iframe ref={iframe} className="bgm-youtube-frame" title="YouTube BGM player" allow="autoplay" onLoad={() => iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [volume] }), "https://www.youtube.com")} src={`https://www.youtube.com/embed/${source.videoId}?enablejsapi=1&autoplay=1&playsinline=1`} />}
    {current && <aside className="global-bgm-player" aria-label="BGM 플레이어"><Music size={15} /><strong>{displayBgmTitle(current)}</strong><button onClick={() => void play(current)} aria-label={playing ? "일시정지" : "재생"}>{playing ? <Pause size={15} /> : <Play size={15} />}</button><label><Volume2 size={15} /><input type="range" min="0" max="100" value={volume} onChange={(event) => { const next = Number(event.target.value); setVolume(next); if (audio.current) audio.current.volume = next / 100; iframe.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [next] }), "https://www.youtube.com"); }} aria-label="BGM 음량" /></label><button onClick={stop} aria-label="BGM 닫기"><X size={15} /></button></aside>}
  </PlayerContext.Provider>;
}

export function BgmPlayButton({ item, className = "" }: { item: PageBgmItem; className?: string }) {
  const player = useBgmPlayer();
  return <button className={`bgm-play-button ${className}`} onClick={() => void player.play(item)} title={`${displayBgmTitle(item)} 재생`} aria-label={`${displayBgmTitle(item)} 재생`}>{player.currentId === item.id ? <Pause size={14} /> : <Play size={14} />}</button>;
}
