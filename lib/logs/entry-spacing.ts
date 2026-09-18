import type { LogEntry } from "@/lib/types";

// Only ordinary dialogue is compact. Cards, images and authored CSS panels
// remain separated even when their source metadata belongs to the same speaker.
function dialogueSpeaker(entry: LogEntry | undefined): string | null {
  if (!entry || entry.is_deleted) return null;
  if (entry.document_version === 2 && entry.document) {
    const document = entry.document;
    if (document.kind !== "dialogue" || !document.blocks.length || document.blocks.some((block) => block.type !== "text" && block.type !== "inline-roll")) return null;
    return document.speaker?.name?.trim() || null;
  }
  return entry.entry_type === "dialogue" && !entry.raw_html ? entry.speaker_name?.trim() || null : null;
}

export function isCompactEntrySpacing(entry: LogEntry, previous: LogEntry | undefined): boolean {
  const speaker = dialogueSpeaker(entry);
  return speaker !== null && speaker === dialogueSpeaker(previous);
}
