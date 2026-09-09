"use client";

import type { LogEntry } from "@/lib/types";

export type LogStream = "main" | "casual";

export function isCasualEntry(entry: LogEntry) {
  return entry.document_version === 2 && entry.document?.source.stream?.id === "casual";
}

export function visibleStreamEntries(entries: LogEntry[], stream: LogStream) {
  return entries.filter((entry) => stream === "casual" ? isCasualEntry(entry) : !isCasualEntry(entry));
}

export function LogStreamTabs({ active, onChange }: { active: LogStream; onChange: (stream: LogStream) => void }) {
  return (
    <nav className="log-stream-tabs" aria-label="로그 채널">
      <button type="button" className={active === "main" ? "active" : ""} aria-pressed={active === "main"} onClick={() => onChange("main")}>메인</button>
      <button type="button" className={active === "casual" ? "active" : ""} aria-pressed={active === "casual"} onClick={() => onChange("casual")}>사담</button>
    </nav>
  );
}
