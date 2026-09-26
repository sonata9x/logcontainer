import { projectDocumentText } from "@/lib/logs/model/projection";
import type { LogEntryDocument } from "@/lib/logs/model/types";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import type { CanonicalImportEntry } from "./types";

export const ROLL20_EDIT_SYNC_PREFIX = "R20CE_SYNC_V1:";

type ExistingImportEntry = {
  id: string;
  is_added: boolean;
  document: unknown;
  original_document: unknown;
};

export class AppendImportError extends Error {}

export function isRoll20EditSyncDocument(document: LogEntryDocument) {
  return projectDocumentText(document).trimStart().startsWith(ROLL20_EDIT_SYNC_PREFIX);
}

function sourceIdentity(document: LogEntryDocument) {
  const source = document.source;
  return [source.platform, source.stream?.id ?? "", source.messageId ?? "", source.sourceKey ?? "", source.sourceOrder ?? ""].join("\u001f");
}

export function calculateAppendedImport(existing: ExistingImportEntry[], incoming: CanonicalImportEntry[]) {
  const cleanupEntryIds: string[] = [];
  const baselines: LogEntryDocument[] = [];
  for (const entry of existing) {
    if (entry.is_added) continue;
    const validated = validateLogEntryDocument(entry.original_document ?? entry.document);
    if (!validated.ok) throw new AppendImportError("기존 HTML 원본 블록을 비교할 수 없습니다. HTML 갱신을 사용해주세요.");
    const document = validated.document;
    const hidden = ["hidden", "hidden-message"].includes(document.source.messageType ?? "");
    if (hidden || isRoll20EditSyncDocument(document)) cleanupEntryIds.push(entry.id);
    else baselines.push(document);
  }
  baselines.sort((left, right) => (left.source.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (right.source.sourceOrder ?? Number.MAX_SAFE_INTEGER));
  if (incoming.length < baselines.length) throw new AppendImportError("새 HTML이 기존 로그보다 짧습니다. 앞부분을 포함한 전체 HTML인지 확인하거나 HTML 갱신을 사용해주세요.");
  for (let index = 0; index < baselines.length; index += 1) {
    if (sourceIdentity(baselines[index]) !== sourceIdentity(incoming[index].document)) {
      throw new AppendImportError(`${index + 1}번째 원본 블록이 기존 로그와 다릅니다. 같은 로그의 전체 HTML인지 확인하거나 HTML 갱신을 사용해주세요.`);
    }
  }
  return { appendedEntries: incoming.slice(baselines.length), cleanupEntryIds, baselineCount: baselines.length };
}
