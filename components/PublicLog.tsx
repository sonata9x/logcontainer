"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogEntryBlock } from "@/components/LogEntryBlock";
import { HandoutLibrary } from "@/components/HandoutLibrary";
import type { LogEntry } from "@/lib/types";
import { isCasualEntry, LogStreamTabs, visibleStreamEntries, type LogStream } from "@/components/logs/LogStreamTabs";
import { BgmPlayButton, BgmPlayerProvider } from "@/components/BgmPlayer";
import { PublicBgmMenu } from "@/components/BgmPlaylistDialog";
import { PageExtrasDisplay } from "@/components/PageExtrasPanel";
import type { PageBgmItem, PageExtras } from "@/lib/types";

export function PublicLog({ token, title, initialEntries, totalCount }: { token: string; title: string; initialEntries: LogEntry[]; totalCount: number }) {
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(false);
  const [activeStream, setActiveStream] = useState<LogStream>("main");
  const loadingRef = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const [pageId, setPageId] = useState("");
  const [extras, setExtras] = useState<PageExtras | null>(null);
  const [bgmItems, setBgmItems] = useState<PageBgmItem[]>([]);
  useEffect(() => { void fetch(`/api/publications/${encodeURIComponent(token)}/extras`, { cache: "no-store" }).then((response) => response.json()).then((result) => { if (result.pageId) setPageId(result.pageId); if (result.extras) setExtras(result.extras); if (result.bgmItems) setBgmItems(result.bgmItems); }); }, [token]);
  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    const cursor = entries.at(-1)?.sort_key;
    if (cursor == null) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const response = await fetch(`/api/publications/${encodeURIComponent(token)}/entries?after=${cursor}`);
      const result = await response.json();
      if (!response.ok) return;
      setEntries((current) => [...current, ...(result.entries ?? [])]);
    } catch {
      // Keep the already-rendered public entries available; the button remains retryable.
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [entries, token]);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || entries.length >= totalCount) return;
    const observer = new IntersectionObserver((records) => {
      if (records.some((record) => record.isIntersecting)) void loadMore();
    }, { rootMargin: "400px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [entries.length, loadMore, totalCount]);
  const content = <main className="public-log" data-font={extras?.fontFamily ?? "pretendard"}><header className="public-log-toolbar"><span>{title}</span><div className="toolbar-actions"><HandoutLibrary mode="public" token={token} fontFamily={extras?.fontFamily} /><PublicBgmMenu pageId={pageId} pageTitle={title} publicationToken={token} /></div></header><h1>{title}</h1><PageExtrasDisplay extras={extras} waitingBgm={bgmItems.filter((item) => item.role === "waiting")} />{entries.some(isCasualEntry) && <LogStreamTabs active={activeStream} onChange={setActiveStream} />}<section>{visibleStreamEntries(entries, activeStream).map((entry) => { const bgm = bgmItems.find((item) => item.role === "entry" && item.entry_id === entry.id); return <div className="entry-wrap" key={entry.id}>{bgm && <BgmPlayButton item={bgm} className="entry-bgm-button" />}<LogEntryBlock entry={entry} /></div>; })}</section>{entries.length < totalCount && <div className="load-more-sentinel" ref={sentinel}><button className="button load-more-entries" onClick={loadMore} disabled={loading}>{loading ? "불러오는 중…" : "다음 메시지 50개 불러오기"}</button></div>}</main>;
  return pageId ? <BgmPlayerProvider access={{ pageId, publicationToken: token }}>{content}</BgmPlayerProvider> : content;
}
