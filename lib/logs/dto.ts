import { sanitizeLogHtml } from "@/lib/logs/html";
import { isStoredLogEntryDocumentV2 } from "@/lib/logs/model/validate";
import type { LogEntry } from "@/lib/types";

export const LOG_ENTRY_DTO_COLUMNS = "id, log_id, order_index, sort_key, entry_type, speaker_name, speaker_color, content, raw_html, document_version, document, is_deleted, deleted_at, is_added, updated_by, created_at, updated_at";

export function toLogEntryDto(input: Record<string, unknown>): LogEntry {
  const document = isStoredLogEntryDocumentV2(input.document) ? input.document : null;
  return {
    id: String(input.id),
    log_id: String(input.log_id),
    order_index: Number(input.order_index ?? 0),
    sort_key: Number(input.sort_key ?? Number(input.order_index ?? 0) * 1_000_000),
    entry_type: input.entry_type as LogEntry["entry_type"],
    speaker_name: typeof input.speaker_name === "string" ? input.speaker_name : null,
    speaker_color: typeof input.speaker_color === "string" ? input.speaker_color : null,
    content: typeof input.content === "string" ? input.content : "",
    raw_html: document ? null : typeof input.raw_html === "string" ? sanitizeLogHtml(input.raw_html) : null,
    document_version: document ? 2 : typeof input.document_version === "number" ? input.document_version : null,
    document,
    has_image_content: input.has_image_content === true,
    is_deleted: input.is_deleted === true,
    deleted_at: typeof input.deleted_at === "string" ? input.deleted_at : null,
    is_added: input.is_added === true,
    updated_by: typeof input.updated_by === "string" ? input.updated_by : null,
    created_at: typeof input.created_at === "string" ? input.created_at : "",
    updated_at: typeof input.updated_at === "string" ? input.updated_at : ""
  };
}
