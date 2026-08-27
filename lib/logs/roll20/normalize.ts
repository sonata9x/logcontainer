import * as cheerio from "cheerio";
import type { ParserWarning } from "@/lib/logs/model/types";
import type { Roll20SourceRecord } from "./source";
import { ROLL20_HEADER_SELECTOR } from "./generated-ui";

function semanticText(record: Roll20SourceRecord) {
  if (!record.renderedHtml) return `${record.who ?? ""}\n${record.content || record.htmlContent}`.replace(/\s+/g, " ").trim();
  const $ = cheerio.load(record.renderedHtml, null, false);
  const message = $(".message").first().clone();
  message.find(ROLL20_HEADER_SELECTOR).remove();
  return message.text().replace(/\s+/g, " ").trim();
}

export function normalizeLogicalMessages(records: Roll20SourceRecord[]) {
  const warnings: ParserWarning[] = [];
  let structuralDuplicateCount = 0;
  const consumed = new Set<number>();
  const normalized: Roll20SourceRecord[] = [];

  records.forEach((record, index) => {
    if (consumed.has(index) || !record.renderedHtml || !record.messageId) { if (!consumed.has(index)) normalized.push(record); return; }
    const candidates = records.map((candidate, candidateIndex) => ({ candidate, candidateIndex })).filter(({ candidate, candidateIndex }) => candidateIndex > index && candidate.renderedHtml && candidate.messageId === record.messageId && candidate.structuralLane !== record.structuralLane);
    if (!candidates.length) { normalized.push(record); return; }
    const merged = { ...record, alternateHtml: [...record.alternateHtml] };
    const primaryText = semanticText(record);
    for (const { candidate, candidateIndex } of candidates) {
      consumed.add(candidateIndex);
      structuralDuplicateCount += 1;
      const candidateText = semanticText(candidate);
      if (candidateText !== primaryText && candidate.renderedHtml) {
        merged.alternateHtml.push(candidate.renderedHtml);
        warnings.push({ code: "structural-content-mismatch", message: "같은 message ID의 구조적 DOM 내용이 달라 두 내용을 모두 보존했습니다.", sourceMessageId: record.messageId });
      }
      if (!merged.who && candidate.who) merged.who = candidate.who;
    }
    normalized.push(merged);
  });
  return { records: normalized, structuralDuplicateCount, warnings };
}
