import * as cheerio from "cheerio";
import { projectDocumentText } from "@/lib/logs/model/projection";
import type { LogEntryDocument, ParserWarning, Roll20ImportReportV2 } from "@/lib/logs/model/types";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import { parseRoll20Blocks } from "./blocks";
import { filterErrorImageDuplicates } from "./duplicates";
import { normalizeLogicalMessages } from "./normalize";
import { detectRoll20Source, type Roll20SourceRecord } from "./source";

export type Roll20ImportOptionsV2 = { removeHiddenMessages?: boolean; removeDuplicateMessages?: boolean };

function kind(record: Roll20SourceRecord): LogEntryDocument["kind"] {
  if (["desc", "emote"].includes(record.type)) return "description";
  if (["error", "system", "hidden", "hidden-message"].includes(record.type)) return "system";
  return "dialogue";
}

function renderedMetadata(record: Roll20SourceRecord) {
  if (!record.renderedHtml) return { avatarUrl: null, color: null, timestampRaw: null, timestampIso: null };
  const $ = cheerio.load(record.renderedHtml, null, false);
  const avatarValue = $(".avatar img, .character-avatar img, img.avatar, img.character-avatar").first().attr("src");
  let avatarUrl: string | null = null;
  try { if (avatarValue) { const url = new URL(avatarValue); if (url.protocol === "https:") avatarUrl = url.href; } } catch {}
  const speakerStyle = $(".by, .speaker").first().attr("style") ?? "";
  const color = speakerStyle.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim() ?? null;
  const timestampRaw = $(".tstamp, .timestamp, time").first().text().trim() || null;
  let timestampIso: string | null = null;
  if (timestampRaw && !Number.isNaN(Date.parse(timestampRaw))) timestampIso = new Date(timestampRaw).toISOString();
  return { avatarUrl, color, timestampRaw, timestampIso };
}

export function importRoll20HtmlV2(source: string, options: Roll20ImportOptionsV2 = {}) {
  const detected = detectRoll20Source(source);
  const sourceMessageCount = detected.records.length;
  const normalization = normalizeLogicalMessages(detected.records);
  let hiddenRemovedCount = 0;
  const visible = normalization.records.filter((record) => {
    const hidden = record.type === "hidden" || record.type === "hidden-message";
    if (options.removeHiddenMessages && hidden) { hiddenRemovedCount += 1; return false; }
    return true;
  });
  const parserWarnings: ParserWarning[] = [...normalization.warnings];
  let unknownFallbackCount = 0;
  let sanitizedStyleCount = 0;
  let droppedStyleCount = 0;
  const parsedDocuments = visible.map((record): LogEntryDocument => {
    const blocks = parseRoll20Blocks(record);
    const recordWarnings = blocks.warnings.map((warning) => ({ ...warning, sourceMessageId: warning.sourceMessageId ?? record.messageId }));
    parserWarnings.push(...recordWarnings);
    unknownFallbackCount += blocks.unknownFallbackCount;
    sanitizedStyleCount += blocks.sanitizedStyleCount;
    droppedStyleCount += blocks.droppedStyleCount;
    const metadata = renderedMetadata(record);
    return {
      version: 2,
      kind: kind(record),
      source: { platform: "roll20", messageId: record.messageId, sourceKey: record.sourceKey, sourceOrder: record.sourceOrder },
      speaker: record.who || metadata.avatarUrl || metadata.color ? { name: record.who?.replace(/[:：]\s*$/, "") ?? null, color: metadata.color, avatarUrl: metadata.avatarUrl } : null,
      timestamp: { raw: metadata.timestampRaw, iso: metadata.timestampIso },
      blocks: blocks.blocks,
      warnings: recordWarnings
    };
  });
  const duplicates = filterErrorImageDuplicates(parsedDocuments, options.removeDuplicateMessages === true);
  const documents = duplicates.documents.map((document) => {
    const validated = validateLogEntryDocument(document);
    if (!validated.ok) throw new Error(validated.error);
    return validated.document;
  });
  const warnings = [...parserWarnings, ...documents.flatMap((document) => document.warnings)].filter((warning, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(warning)) === index);
  const report: Roll20ImportReportV2 = {
    provider: "roll20", parserVersion: 2, sourceFormat: detected.format, importedAt: new Date().toISOString(), sourceMessageCount,
    logicalMessageCount: documents.length, structuralDuplicateCount: normalization.structuralDuplicateCount,
    errorDuplicateCount: duplicates.errorDuplicateCount, hiddenRemovedCount, unknownFallbackCount, sanitizedStyleCount,
    droppedStyleCount, warningCount: warnings.length, warnings
  };
  return {
    platform: "roll20" as const,
    documents,
    entries: documents.map((document, orderIndex) => ({
      order_index: orderIndex,
      entry_type: document.kind === "dialogue" ? "dialogue" : "system",
      speaker_name: document.speaker?.name ?? null,
      speaker_color: document.speaker?.color ?? null,
      content: projectDocumentText(document),
      original_content: projectDocumentText(document),
      raw_html: null,
      document_version: 2,
      document,
      original_document: document,
      metadata: { roll20MessageId: document.source.messageId, parserVersion: 2, warnings: document.warnings }
    })),
    report
  };
}
