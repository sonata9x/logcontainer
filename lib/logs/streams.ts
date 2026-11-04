import type { LogEntry } from "@/lib/types";

export type LogStreamOption = { id: string; name: string };

export function entryStreamId(entry: LogEntry) {
  const id = entry.document_version === 2 ? entry.document?.source.stream?.id : null;
  return id === "casual" || id?.startsWith("ccfolia-tab_") ? id : "main";
}

export function parseLogStreams(value: unknown): LogStreamOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 1000).flatMap((item) => {
    if (!item || typeof item.id !== "string" || !item.id.startsWith("ccfolia-tab_") || typeof item.name !== "string" || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name.slice(0, 200) }];
  });
}

export function logStreamOptions(entries: LogEntry[], catalog?: unknown): LogStreamOption[] {
  const options = new Map(parseLogStreams(catalog).map((stream) => [stream.id, stream]));
  for (const entry of entries) {
    const id = entryStreamId(entry);
    if (!options.has(id)) options.set(id, { id, name: id === "main" ? "메인" : id === "casual" ? "사담" : entry.document?.source.stream?.name || id });
  }
  if (!options.size) return [{ id: "main", name: "메인" }];
  if (options.has("main")) return [options.get("main")!, ...[...options.values()].filter((stream) => stream.id !== "main")];
  return [...options.values()];
}

export function effectiveLogStream(entries: LogEntry[], active: string, catalog?: unknown) {
  const options = logStreamOptions(entries, catalog);
  return options.some((stream) => stream.id === active) ? active : options[0].id;
}
