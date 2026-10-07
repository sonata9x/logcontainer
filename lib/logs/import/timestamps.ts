import type { LogEntryDocument } from "@/lib/logs/model/types";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import type { CanonicalImportEntry } from "./types";

type ExistingTimestampEntry = {
  id: string;
  is_added: boolean;
  document: unknown;
};

export type TimestampImportUpdate = {
  entry_id: string;
  message_id: string;
  next_timestamp: LogEntryDocument["timestamp"];
  next_timestamp_explicit: boolean;
};

export function calculateTimestampImport(existing: ExistingTimestampEntry[], incoming: CanonicalImportEntry[]) {
  const incomingByMessageId = new Map<string, CanonicalImportEntry[]>();
  for (const entry of incoming) {
    const messageId = entry.document.source.messageId;
    if (!messageId) continue;
    const matches = incomingByMessageId.get(messageId) ?? [];
    matches.push(entry);
    incomingByMessageId.set(messageId, matches);
  }

  const existingCounts = new Map<string, number>();
  const validatedExisting: Array<{ id: string; document: LogEntryDocument }> = [];
  for (const entry of existing) {
    if (entry.is_added) continue;
    const validated = validateLogEntryDocument(entry.document);
    if (!validated.ok) continue;
    const messageId = validated.document.source.messageId;
    if (!messageId) continue;
    validatedExisting.push({ id: entry.id, document: validated.document });
    existingCounts.set(messageId, (existingCounts.get(messageId) ?? 0) + 1);
  }

  let matchedCount = 0;
  let ambiguousCount = 0;
  const updates: TimestampImportUpdate[] = [];
  for (const entry of validatedExisting) {
    const messageId = entry.document.source.messageId!;
    const candidates = incomingByMessageId.get(messageId) ?? [];
    if (candidates.length !== 1 || existingCounts.get(messageId) !== 1) {
      if (candidates.length > 0) ambiguousCount += 1;
      continue;
    }
    matchedCount += 1;
    const next = candidates[0].document;
    const timestampExplicit = Boolean(next.presentation?.timestampExplicit);
    if (entry.document.timestamp.raw === next.timestamp.raw
      && entry.document.timestamp.iso === next.timestamp.iso
      && Boolean(entry.document.presentation?.timestampExplicit) === timestampExplicit) continue;
    updates.push({
      entry_id: entry.id,
      message_id: messageId,
      next_timestamp: next.timestamp,
      next_timestamp_explicit: timestampExplicit
    });
  }

  return {
    updates,
    matchedCount,
    changedCount: updates.length,
    ambiguousCount,
    unmatchedCount: Math.max(0, validatedExisting.length - matchedCount - ambiguousCount)
  };
}
