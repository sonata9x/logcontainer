import { randomUUID } from "node:crypto";
import type { LogEntryDocument, RichStyle } from "./types";

export function createManualLogEntryDocument(kind: LogEntryDocument["kind"], speakerName: string | null, text: string): LogEntryDocument {
  return {
    version: 2,
    kind,
    source: { platform: "manual", messageId: null, sourceKey: null, sourceOrder: null },
    speaker: speakerName ? { name: speakerName.replace(/[:：]\s*$/, ""), color: null, avatarUrl: null } : null,
    timestamp: { raw: null, iso: null },
    presentation: { speakerExplicit: Boolean(speakerName), avatarExplicit: false, timestampExplicit: false, continuation: false },
    blocks: [{ id: `text_${randomUUID()}`, type: "text", text }],
    warnings: []
  };
}

export function createManualStyledLogEntryDocument(
  kind: LogEntryDocument["kind"],
  speakerName: string | null,
  segments: Array<{ text: string; style: RichStyle }>
): LogEntryDocument {
  const document = createManualLogEntryDocument(kind, speakerName, "");
  document.blocks = [{
    id: `rich_${randomUUID()}`,
    type: "rich",
    nodes: segments.map((segment) => ({
      id: `element_${randomUUID()}`,
      type: "element" as const,
      tag: "span" as const,
      href: null,
      title: null,
      style: segment.style,
      children: [{ id: `richtext_${randomUUID()}`, type: "text" as const, text: segment.text }]
    }))
  }];
  return document;
}
