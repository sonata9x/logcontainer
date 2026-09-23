import { randomUUID } from "node:crypto";
import type { ImageDisplay, LogEntryDocument, RichStyle } from "./types";

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

export function createManualImageLogEntryDocument(
  kind: LogEntryDocument["kind"],
  speakerName: string | null,
  image: { src: string; href?: string | null; alt?: string | null; caption?: string | null; align?: ImageDisplay["align"] }
): LogEntryDocument {
  const document = createManualLogEntryDocument(kind, speakerName, "");
  document.blocks = [{
    id: `image_${randomUUID()}`,
    type: "image",
    src: image.src,
    href: image.href ?? null,
    alt: image.alt ?? null,
    caption: image.caption ?? null,
    display: { width: null, height: null, minWidth: null, maxWidth: null, align: image.align ?? (kind === "description" ? "center" : "left") }
  }];
  return document;
}
