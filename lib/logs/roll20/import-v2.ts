import * as cheerio from "cheerio";
import { projectDocumentText } from "@/lib/logs/model/projection";
import type { LogEntryDocument, ParserWarning, Roll20ImportReportV2 } from "@/lib/logs/model/types";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import { parseRoll20Blocks } from "./blocks";
import { filterErrorImageDuplicates } from "./duplicates";
import { normalizeLogicalMessages, renderedSemanticPayload } from "./normalize";
import { detectRoll20Source, type Roll20SourceRecord } from "./source";

export type Roll20ImportOptionsV2 = { removeHiddenMessages?: boolean; removeDuplicateMessages?: boolean };

function kind(record: Roll20SourceRecord): LogEntryDocument["kind"] {
  if (["desc", "emote"].includes(record.type)) return "description";
  if (["error", "system", "hidden", "hidden-message"].includes(record.type)) return "system";
  return "dialogue";
}

function renderedMetadata(record: Roll20SourceRecord) {
  if (!record.renderedHtml) return { avatarUrl: null, color: null, speakerName: null, speakerExplicit: Boolean(record.who), avatarExplicit: false, timestampExplicit: false, selfMessage: false, timestampRaw: null, timestampIso: null };
  const $ = cheerio.load(record.renderedHtml, null, false);
  const message = $(".message").first();
  const avatarValue = $(".avatar img, .character-avatar img, img.avatar, img.character-avatar").first().attr("src");
  let avatarUrl: string | null = null;
  try { if (avatarValue) { const url = new URL(avatarValue); if (url.protocol === "https:") avatarUrl = url.href; } } catch {}
  const speakerStyle = $(".by, .speaker").first().attr("style") ?? "";
  const color = speakerStyle.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim() ?? null;
  const speakerName = $(".by, .speaker, .author, .username, .name, .message-sender, .byline").first().text().replace(/[:：]\s*$/, "").trim() || null;
  const timestampRaw = $(".tstamp, .timestamp, time").first().text().trim() || null;
  let timestampIso: string | null = null;
  if (timestampRaw && !Number.isNaN(Date.parse(timestampRaw))) timestampIso = new Date(timestampRaw).toISOString();
  return { avatarUrl, color, speakerName, speakerExplicit: Boolean(speakerName), avatarExplicit: Boolean(avatarValue), timestampExplicit: Boolean(timestampRaw), selfMessage: message.hasClass("you"), timestampRaw, timestampIso };
}

function plainSourceText(record: Roll20SourceRecord) {
  const html = record.content || record.htmlContent;
  if (!/<\/?[a-z][\s\S]*>/i.test(html)) return html.replace(/^\s*\/desc\s*/i, "").replace(/\$\[\[\d+]]/g, "").replace(/\s+/g, " ").trim();
  return cheerio.load(html, null, false).root().text().replace(/\s+/g, " ").trim();
}

function enrichMsgdataRecords(msgdata: Roll20SourceRecord[], rendered: Roll20SourceRecord[], warnings: ParserWarning[]) {
  const unused = new Set(rendered.map((_record, index) => index));
  const enriched = msgdata.map((record) => {
    let matchIndex = rendered.findIndex((candidate, index) => unused.has(index) && Boolean(candidate.messageId) && (candidate.messageId === record.messageId || candidate.messageId === record.sourceKey));
    if (matchIndex < 0) {
      const sourceText = plainSourceText(record);
      if (sourceText) {
        const matches = rendered.map((candidate, index) => ({ candidate, index })).filter(({ candidate, index }) => unused.has(index) && renderedSemanticPayload(candidate).includes(sourceText));
        if (matches.length === 1) matchIndex = matches[0].index;
      }
    }
    if (matchIndex < 0) return record;
    unused.delete(matchIndex);
    const candidate = rendered[matchIndex];
    return {
      ...record,
      who: record.who || candidate.who,
      renderedHtml: candidate.renderedHtml,
      structuralLane: candidate.structuralLane,
      alternateHtml: [...record.alternateHtml, ...candidate.alternateHtml]
    };
  });
  if (unused.size) warnings.push({ code: "rendered-enrichment-unmatched", message: `rendered DOM ${unused.size}개를 msgdata와 안전하게 연결하지 못해 msgdata 원문을 유지했습니다.` });
  return enriched;
}

export function importRoll20HtmlV2(source: string, options: Roll20ImportOptionsV2 = {}) {
  const detected = detectRoll20Source(source);
  const sourceMessageCount = detected.records.length;
  const primaryNormalization = normalizeLogicalMessages(detected.records);
  const renderedNormalization = detected.format === "msgdata" && detected.renderedRecords.length ? normalizeLogicalMessages(detected.renderedRecords) : null;
  const parserWarnings: ParserWarning[] = [...primaryNormalization.warnings, ...(renderedNormalization?.warnings ?? [])];
  const normalizedRecords = renderedNormalization
    ? enrichMsgdataRecords(primaryNormalization.records, renderedNormalization.records, parserWarnings)
    : primaryNormalization.records;
  let hiddenRemovedCount = 0;
  const visible = normalizedRecords.filter((record) => {
    const hidden = record.type === "hidden" || record.type === "hidden-message";
    if (options.removeHiddenMessages && hidden) { hiddenRemovedCount += 1; return false; }
    return true;
  });
  let unknownFallbackCount = 0;
  let sanitizedStyleCount = 0;
  let droppedStyleCount = 0;
  const parsedDocuments: LogEntryDocument[] = [];
  type Speaker = NonNullable<LogEntryDocument["speaker"]>;
  let previousDialogueSpeaker: Speaker | null = null;
  for (const record of visible) {
    const blocks = parseRoll20Blocks(record);
    const recordWarnings = blocks.warnings.map((warning) => ({ ...warning, sourceMessageId: warning.sourceMessageId ?? record.messageId }));
    parserWarnings.push(...recordWarnings);
    unknownFallbackCount += blocks.unknownFallbackCount;
    sanitizedStyleCount += blocks.sanitizedStyleCount;
    droppedStyleCount += blocks.droppedStyleCount;
    const metadata = renderedMetadata(record);
    const documentKind = kind(record);
    const explicitName = record.who?.replace(/[:：]\s*$/, "") || metadata.speakerName;
    const previousSpeaker = previousDialogueSpeaker as Speaker | null;
    const inherited: boolean = documentKind === "dialogue" && !explicitName && Boolean(previousSpeaker?.name);
    const speaker: LogEntryDocument["speaker"] = explicitName || metadata.avatarUrl || metadata.color
      ? { name: explicitName ?? null, color: metadata.color, avatarUrl: metadata.avatarUrl }
      : inherited ? previousSpeaker : null;
    const document: LogEntryDocument = {
      version: 2,
      kind: documentKind,
      source: { platform: "roll20", messageId: record.messageId, sourceKey: record.sourceKey, sourceOrder: record.sourceOrder },
      speaker,
      timestamp: { raw: metadata.timestampRaw, iso: metadata.timestampIso },
      presentation: {
        speakerExplicit: metadata.speakerExplicit,
        avatarExplicit: metadata.avatarExplicit,
        timestampExplicit: metadata.timestampExplicit,
        continuation: documentKind === "dialogue" && !metadata.speakerExplicit && Boolean(speaker?.name),
        ...(metadata.selfMessage ? { selfMessage: true } : {})
      },
      blocks: blocks.blocks,
      warnings: recordWarnings
    };
    parsedDocuments.push(document);
    if (documentKind === "dialogue" && speaker?.name) previousDialogueSpeaker = speaker;
    else if (documentKind !== "dialogue") previousDialogueSpeaker = null;
  }
  const duplicates = filterErrorImageDuplicates(parsedDocuments, options.removeDuplicateMessages === true);
  const documents = duplicates.documents.map((document) => {
    const validated = validateLogEntryDocument(document);
    if (!validated.ok) throw new Error(validated.error);
    return validated.document;
  });
  const warnings = [...parserWarnings, ...documents.flatMap((document) => document.warnings)].filter((warning, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(warning)) === index);
  const report: Roll20ImportReportV2 = {
    provider: "roll20", parserVersion: 2, sourceFormat: detected.format, importedAt: new Date().toISOString(), sourceMessageCount,
    logicalMessageCount: documents.length, structuralDuplicateCount: primaryNormalization.structuralDuplicateCount + (renderedNormalization?.structuralDuplicateCount ?? 0),
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
