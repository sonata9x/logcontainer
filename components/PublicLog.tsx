"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LogEntryBlock } from "@/components/LogEntryBlock";
import type { LogEntry } from "@/lib/types";

export function PublicLog({ token, title, initialEntries, totalCount }: { token: string; title: string; initialEntries: LogEntry[]; totalCount: number }) {
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);
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
  return <main className="public-log"><h1>{title}</h1><section>{entries.map((entry) => <LogEntryBlock key={entry.id} entry={entry} />)}</section>{entries.length < totalCount && <div className="load-more-sentinel" ref={sentinel}><button className="button load-more-entries" onClick={loadMore} disabled={loading}>{loading ? "불러오는 중…" : "다음 메시지 50개 불러오기"}</button></div>}</main>;
}
