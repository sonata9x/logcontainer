import type { ParserWarning } from "@/lib/logs/model/types";
import type { Roll20SourceRecord } from "./source";

const NEARBY_DOM_DISTANCE = 4;

export function renderedSemanticPayload(record: Roll20SourceRecord) {
  return record.semanticPayload ?? `${record.content || record.htmlContent}`.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function compatibleContent(left: string, right: string) {
  if (left === right) return true;
  if (!left || !right) return true;
  return left.includes(right) || right.includes(left);
}

function headerScore(record: Roll20SourceRecord) {
  return record.headerScore || (record.who ? 1 : 0);
}

function shouldConsiderPair(records: Roll20SourceRecord[], leftIndex: number, rightIndex: number) {
  const left = records[leftIndex];
  const right = records[rightIndex];
  if (!left.renderedHtml || !right.renderedHtml || !left.messageId || left.messageId !== right.messageId) return false;
  const nearby = rightIndex - leftIndex <= NEARBY_DOM_DISTANCE;
  return nearby || (Boolean(left.structuralLane) && left.structuralLane !== right.structuralLane);
}

export function normalizeLogicalMessages(records: Roll20SourceRecord[]) {
  const warnings: ParserWarning[] = [];
  let structuralDuplicateCount = 0;
  const consumed = new Set<number>();
  const normalized: Roll20SourceRecord[] = [];

  const byMessageId = new Map<string, number[]>();
  records.forEach((record, index) => {
    if (!record.renderedHtml || !record.messageId) return;
    const group = byMessageId.get(record.messageId) ?? [];
    group.push(index);
    byMessageId.set(record.messageId, group);
  });

  records.forEach((record, index) => {
    if (consumed.has(index) || !record.renderedHtml || !record.messageId) {
      if (!consumed.has(index)) normalized.push(record);
      return;
    }
    const indexes = [index, ...(byMessageId.get(record.messageId) ?? [])
      .filter((candidateIndex) => candidateIndex > index && !consumed.has(candidateIndex) && shouldConsiderPair(records, index, candidateIndex))];
    if (indexes.length === 1) { normalized.push(record); return; }

    const members = indexes.map((memberIndex) => ({ index: memberIndex, record: records[memberIndex], payload: renderedSemanticPayload(records[memberIndex]) }));
    const primary = [...members].sort((left, right) => headerScore(right.record) - headerScore(left.record) || right.payload.length - left.payload.length || left.index - right.index)[0];
    const merged: Roll20SourceRecord = {
      ...record,
      type: primary.record.type || record.type,
      who: members.find((member) => member.record.who)?.record.who ?? null,
      renderedHtml: primary.record.renderedHtml,
      structuralLane: primary.record.structuralLane,
      alternateHtml: [...record.alternateHtml]
    };
    for (const member of members) {
      if (member.index === index) continue;
      consumed.add(member.index);
      structuralDuplicateCount += 1;
    }
    for (const member of members) {
      if (member.index === primary.index || compatibleContent(primary.payload, member.payload)) continue;
      if (member.record.renderedHtml && !merged.alternateHtml.includes(member.record.renderedHtml)) merged.alternateHtml.push(member.record.renderedHtml);
      warnings.push({ code: "structural-content-mismatch", message: "같은 message ID의 구조적 DOM 내용이 달라 두 내용을 모두 보존했습니다.", sourceMessageId: record.messageId });
    }
    normalized.push(merged);
  });
  return { records: normalized, structuralDuplicateCount, warnings };
}
