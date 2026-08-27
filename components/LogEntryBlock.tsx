import { sanitizeLogHtml } from "@/lib/logs/html";
import type { LogEntry } from "@/lib/types";
import { isStoredLogEntryDocumentV2 } from "@/lib/logs/model/validate";
import { Roll20V2Renderer } from "@/components/logs/Roll20V2Renderer";

export function LogEntryBlock({ entry }: { entry: LogEntry }) {
  if (entry.document_version === 2 && isStoredLogEntryDocumentV2(entry.document)) {
    return <div className="log-entry log-entry-v2"><Roll20V2Renderer document={entry.document} /></div>;
  }
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
