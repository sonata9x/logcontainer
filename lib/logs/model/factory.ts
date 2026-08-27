import { randomUUID } from "node:crypto";
import type { LogEntryDocument } from "./types";

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
