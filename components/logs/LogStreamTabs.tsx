"use client";

import type { LogEntry } from "@/lib/types";
import { normalizeEntryTimestampDisplay } from "@/lib/logs/statistics";
import { effectiveLogStream, entryStreamId, logStreamOptions } from "@/lib/logs/streams";

export type LogStream = string;

export function isCasualEntry(entry: LogEntry) {
  return entry.document_version === 2 && entry.document?.source.stream?.id === "casual";
}

export function visibleStreamEntries(entries: LogEntry[], stream: LogStream, catalog?: unknown) {
  const active = effectiveLogStream(entries, stream, catalog);
  return normalizeEntryTimestampDisplay(entries).filter((entry) => entryStreamId(entry) === active);
}

export function LogStreamTabs({ entries, streams, active, onChange }: { entries: LogEntry[]; streams?: unknown; active: LogStream; onChange: (stream: LogStream) => void }) {
  const options = logStreamOptions(entries, streams);
  if (options.length < 2) return null;
  const selected = effectiveLogStream(entries, active, streams);
  return (
    <nav className="log-stream-tabs" aria-label="로그 채널">
      {options.map((stream) => <button key={stream.id} type="button" className={selected === stream.id ? "active" : ""} aria-pressed={selected === stream.id} onClick={() => onChange(stream.id)}>{stream.name}</button>)}
    </nav>
  );
}
