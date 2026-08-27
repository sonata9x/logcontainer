import * as cheerio from "cheerio";
import type { ParserWarning } from "@/lib/logs/model/types";
import type { Roll20SourceRecord } from "./source";
import { ROLL20_HEADER_SELECTOR } from "./generated-ui";

const NEARBY_DOM_DISTANCE = 4;

function renderedMessage(record: Roll20SourceRecord) {
  const $ = cheerio.load(record.renderedHtml ?? "", null, false);
  return { $, message: $(".message").first() };
}

export function renderedSemanticPayload(record: Roll20SourceRecord) {
  if (!record.renderedHtml) return `${record.content || record.htmlContent}`.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const { $, message } = renderedMessage(record);
  const content = message.clone();
  content.find(ROLL20_HEADER_SELECTOR).remove();
  const text = content.text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const images = content.find("img[src]").toArray().map((element) => $(element).attr("src") ?? "");
  const rolls = content.find(".inlinerollresult").toArray().map((element) => `${$(element).text().trim()}@${$(element).attr("title") ?? ""}`);
  const templates = content.find("[class*='sheet-rolltemplate-']").toArray().map((element) => $(element).attr("class") ?? "");
  return [text, ...images, ...rolls, ...templates].filter(Boolean).join("\n");
}

function compatibleContent(left: string, right: string) {
  if (left === right) return true;
  if (!left || !right) return true;
  return left.includes(right) || right.includes(left);
}

function headerScore(record: Roll20SourceRecord) {
  if (!record.renderedHtml) return record.who ? 1 : 0;
  const { message } = renderedMessage(record);
  return Number(Boolean(record.who)) * 4
    + Number(message.find(".avatar, .character-avatar, img.avatar, img.character-avatar").length > 0) * 2
    + Number(message.find(".tstamp, .timestamp, time").length > 0);
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

  records.forEach((record, index) => {
    if (consumed.has(index) || !record.renderedHtml || !record.messageId) {
      if (!consumed.has(index)) normalized.push(record);
      return;
    }
    const indexes = [index, ...records.map((_candidate, candidateIndex) => candidateIndex)
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
