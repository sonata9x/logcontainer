import { sanitizeLogHtml } from "@/lib/logs/html";
import type { LogEntry } from "@/lib/types";

export function LogEntryBlock({ entry }: { entry: LogEntry }) {
  if (entry.raw_html) {
    return <div className="log-entry" dangerouslySetInnerHTML={{ __html: sanitizeLogHtml(entry.raw_html) }} />;
  }
  return (
    <article className={`log-entry entry-${entry.entry_type}`}>
      {entry.speaker_name && <div className="log-entry-speaker" style={{ color: entry.speaker_color ?? undefined }}>{entry.speaker_name}</div>}
      <div className="log-entry-content">{entry.content}</div>
    </article>
  );
}
