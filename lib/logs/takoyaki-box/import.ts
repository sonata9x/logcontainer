import * as cheerio from "cheerio";
import { projectDocumentText } from "@/lib/logs/model/projection";
import type { LogEntryDocument, ParserWarning, TakoyakiBoxImportReportV1 } from "@/lib/logs/model/types";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import { parseRichHtml } from "@/lib/logs/roll20/rich";
import { stableRoll20Id } from "@/lib/logs/roll20/id";
import type { CanonicalImportResult } from "@/lib/logs/import/types";

const EVENT_SELECTOR = ".msg, .msg-script, .msg-choice, .sys, .dcard-tkt, .stat-log";

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function safeHttpsUrl(value: string | undefined) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

function backgroundImageUrl(style: string | undefined) {
  const value = style?.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i)?.[2];
  return safeHttpsUrl(value);
}

function streamName(id: string, displayed: string) {
  if (displayed) return displayed;
  if (id === "main") return "메인";
  if (id === "casual") return "사담";
  if (id === "system") return "시스템";
  return id || "메인";
}

export function importTakoyakiBoxHtml(source: string): CanonicalImportResult {
  const $ = cheerio.load(source);
  const panes = $(".tkbx-panes > .log").toArray();
  if (!panes.length) throw new Error("Takoyaki Box .tkbx-panes .log was not found.");
  const events = panes.flatMap((pane) => $(pane).children().toArray()).filter((element) => $(element).is(EVENT_SELECTOR));
  if (!events.length) throw new Error("Takoyaki Box message elements were not found.");
  const warnings: ParserWarning[] = [];
  const documents = events.map((element, sourceOrder) => {
    const node = $(element);
    const sourceKey = node.attr("data-id") || node.attr("data-message-id") || node.attr("id") || `event-${sourceOrder}`;
    const streamId = normalizeText(node.attr("data-tab") ?? "") || "main";
    const displayedStream = normalizeText(node.find(".msg-chan").first().text());
    const messageType = node.hasClass("msg-script") ? "script" : node.hasClass("msg-choice") ? "choice" : node.hasClass("sys") ? "system" : node.hasClass("dcard-tkt") ? "dice" : node.hasClass("stat-log") ? "stat" : node.hasClass("act") ? "narration" : "message";
    const whoSpans = node.find(".who > span").toArray().filter((span) => !$(span).hasClass("msg-chan"));
    const speakerName = messageType === "message" || messageType === "narration" ? normalizeText(whoSpans.length ? $(whoSpans[0]).text() : "") || null : null;
    const timestampRaw = whoSpans.length > 1 ? normalizeText($(whoSpans.at(-1)!).text()) || null : null;
    const timestampIso = timestampRaw && !Number.isNaN(Date.parse(timestampRaw)) ? new Date(timestampRaw).toISOString() : null;
    const avatarUrl = backgroundImageUrl(node.find(".pic").first().attr("style"));
    const content = node.clone();
    content.find(".who, .pic, .msg-actions, .msg-edit, .msg-chan, .mk-script-lock").remove();
    const body = content.find(".body").first();
    const contentHtml = body.length ? body.html() ?? "" : content.html() ?? "";
    const parsed = parseRichHtml(contentHtml, `takoyaki:${sourceKey}:${sourceOrder}`);
    const recordWarnings = parsed.warnings.map((warning) => ({ ...warning, sourceMessageId: sourceKey }));
    warnings.push(...recordWarnings);
    const document: LogEntryDocument = {
      version: 2,
      kind: messageType === "message" ? "dialogue" : messageType === "narration" ? "description" : "system",
      source: {
        platform: "takoyaki-box", messageId: sourceKey, sourceKey, sourceOrder,
        stream: { id: streamId, name: streamName(streamId, displayedStream) }, messageType
      },
      speaker: speakerName || avatarUrl ? { name: speakerName, color: null, avatarUrl } : null,
      timestamp: { raw: timestampRaw, iso: timestampIso },
      presentation: {
        speakerExplicit: Boolean(speakerName), avatarExplicit: Boolean(avatarUrl), timestampExplicit: Boolean(timestampRaw), continuation: false,
        ...(node.hasClass("priv") ? { private: true } : {})
      },
      blocks: parsed.nodes.length ? [{ id: stableRoll20Id("rich", "takoyaki", sourceKey, sourceOrder), type: "rich", nodes: parsed.nodes }] : [{ id: stableRoll20Id("text", "takoyaki", sourceKey, sourceOrder), type: "text", text: normalizeText(node.text()) }],
      warnings: recordWarnings
    };
    const validated = validateLogEntryDocument(document);
    if (!validated.ok) throw new Error(validated.error);
    return validated.document;
  });
  const report: TakoyakiBoxImportReportV1 = {
    provider: "takoyaki-box", parserVersion: 1, sourceFormat: "exported_html", importedAt: new Date().toISOString(),
    sourceMessageCount: events.length, logicalMessageCount: documents.length,
    streamCount: new Set(documents.map((document) => document.source.stream?.id)).size,
    warningCount: warnings.length, warnings
  };
  return {
    platform: "takoyaki-box", documents,
    entries: documents.map((document, orderIndex) => ({
      order_index: orderIndex, entry_type: document.kind === "dialogue" ? "dialogue" : "system",
      speaker_name: document.speaker?.name ?? null, speaker_color: document.speaker?.color ?? null,
      content: projectDocumentText(document), original_content: null, raw_html: null, document_version: 2,
      document, original_document: null, sort_key: (orderIndex + 1) * 1_000_000,
      has_image_content: document.blocks.some((block) => block.type === "image" || block.type === "rich" && JSON.stringify(block.nodes).includes('"type":"image"')),
      metadata: {}
    })), report
  };
}
