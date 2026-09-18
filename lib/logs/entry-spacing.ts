import type { LogEntry } from "@/lib/types";
import type { RichNode } from "@/lib/logs/model/types";

function isInlineDialogueNode(node: RichNode): boolean {
  if (node.type === "image") return false;
  if (node.type !== "element") return true;
  const style = Object.fromEntries(node.style.map(({ property, value }) => [property, value.trim().toLowerCase()]));
  if (["div", "p", "blockquote", "pre"].includes(node.tag) || style.position === "absolute" || ["block", "flex", "grid", "table", "table-row", "table-cell"].includes(style.display)) return false;
  return node.children.every(isInlineDialogueNode);
}

// Only ordinary dialogue is compact. Cards, images and authored CSS panels
// remain separated even when their source metadata belongs to the same speaker.
function dialogueSpeaker(entry: LogEntry | undefined): string | null {
  if (!entry || entry.is_deleted) return null;
  if (entry.document_version === 2 && entry.document) {
    const document = entry.document;
    if (document.kind !== "dialogue" || !document.blocks.length || document.blocks.some((block) => block.type !== "text" && block.type !== "inline-roll" && !(block.type === "rich" && block.nodes.every(isInlineDialogueNode)))) return null;
    return document.speaker?.name?.trim() || null;
  }
  return entry.entry_type === "dialogue" && !entry.raw_html ? entry.speaker_name?.trim() || null : null;
}

export function isCompactEntrySpacing(entry: LogEntry, previous: LogEntry | undefined): boolean {
  if (entry.document_version === 2 && entry.document) {
    const { speaker, timestamp, presentation } = entry.document;
    // Use the same visibility rules as the renderer, not inherited metadata.
    const showsAvatar = Boolean(speaker?.avatarUrl) && (presentation?.avatarExplicit ?? true);
    const showsTimestamp = Boolean(timestamp.raw) && (presentation?.timestampExplicit ?? true);
    if (showsAvatar || showsTimestamp) return false;
  }
  const speaker = dialogueSpeaker(entry);
  return speaker !== null && speaker === dialogueSpeaker(previous);
}
