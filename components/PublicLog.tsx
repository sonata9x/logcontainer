"use client";

import { useState } from "react";
import { LogEntryBlock } from "@/components/LogEntryBlock";
import type { LogEntry } from "@/lib/types";

export function PublicLog({ token, title, initialEntries, totalCount }: { token: string; title: string; initialEntries: LogEntry[]; totalCount: number }) {
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(false);
  async function loadMore() {
    const cursor = entries.at(-1)?.sort_key;
    if (cursor == null) return;
    setLoading(true);
    const response = await fetch(`/api/publications/${encodeURIComponent(token)}/entries?after=${cursor}`);
    const result = await response.json();
    setLoading(false);
    if (!response.ok) return;
    setEntries((current) => [...current, ...(result.entries ?? [])]);
  }
  return <main className="public-log"><h1>{title}</h1><section>{entries.map((entry) => <LogEntryBlock key={entry.id} entry={entry} />)}</section>{entries.length < totalCount && <button className="button load-more-entries" onClick={loadMore} disabled={loading}>{loading ? "불러오는 중…" : "다음 메시지 300개 불러오기"}</button>}</main>;
}
