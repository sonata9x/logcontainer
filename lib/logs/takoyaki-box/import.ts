import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { projectDocumentText } from "@/lib/logs/model/projection";
import type { LogEntryDocument, ParserWarning, TakoyakiBoxImportReportV1 } from "@/lib/logs/model/types";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import { parseRichHtml } from "@/lib/logs/roll20/rich";
import { stableRoll20Id } from "@/lib/logs/roll20/id";
import type { CanonicalImportResult } from "@/lib/logs/import/types";
import { safeImageUrl } from "@/lib/logs/model/url";

const EVENT_SELECTOR = ".msg, .msg-script, .msg-choice, .sys, .dcard-tkt, .stat-log";

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function backgroundImageUrl(style: string | undefined) {
  const value = style?.match(/background-image\s*:\s*url\((['"]?)(.*?)\1\)/i)?.[2];
  return safeImageUrl(value);
}

function cssAvatarUrls($: cheerio.CheerioAPI) {
  const result = new Map<string, string>();
  const css = $("style").map((_index, element) => $(element).html() ?? "").get().join("\n");
  const rulePattern = /\.([a-zA-Z0-9_-]+)\s*\{[^{}]*?background-image\s*:\s*url\((['"]?)([\s\S]*?)\2\)[^{}]*\}/gi;
  for (const match of css.matchAll(rulePattern)) {
    const url = safeImageUrl(match[3].trim());
    if (url) result.set(match[1], url);
  }
  return result;
}

function avatarUrlForNode(node: cheerio.Cheerio<AnyNode>, avatarUrls: Map<string, string>) {
  const picture = node.find(".pic").first();
  const inline = backgroundImageUrl(picture.attr("style"));
  if (inline) return inline;
  const nested = safeImageUrl(picture.find("img[src]").first().attr("src") ?? node.find("img.pic[src], .avatar img[src]").first().attr("src"));
  if (nested) return nested;
  const attribute = safeImageUrl(picture.attr("data-avatar") ?? picture.attr("data-src"));
  if (attribute) return attribute;
  const className = (picture.attr("class") ?? "").split(/\s+/).find((value) => avatarUrls.has(value));
  return className ? avatarUrls.get(className) ?? null : null;
}

function timestampText(value: string) {
  return /^(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?(?:\s*[AP]M)?$/i.test(value)
    || /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(value);
}

function inlineColor(style: string | undefined) {
  const color = style?.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim();
  return color && color.length <= 100 && !/[{}]/.test(color) ? color : null;
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
  const avatarUrls = cssAvatarUrls($);
  const documents = events.map((element, sourceOrder) => {
    const node = $(element);
    const sourceKey = node.attr("data-id") || node.attr("data-message-id") || node.attr("id") || `event-${sourceOrder}`;
    const streamId = normalizeText(node.attr("data-tab") ?? "") || "main";
    const displayedStream = normalizeText(node.find(".msg-chan").first().text());
    const messageType = node.hasClass("msg-script") ? "script" : node.hasClass("msg-choice") ? "choice" : node.hasClass("sys") ? "system" : node.hasClass("dcard-tkt") ? "dice" : node.hasClass("stat-log") ? "stat" : node.hasClass("act") ? "narration" : "message";
    const whoSpans = node.find(".who").first().children("span").toArray();
    const speakerSpan = whoSpans.find((span) => !$(span).hasClass("msg-chan") && !timestampText(normalizeText($(span).text())));
    const speakerName = messageType === "message" || messageType === "narration" ? normalizeText(speakerSpan ? $(speakerSpan).text() : "") || null : null;
    const timestampRaw = whoSpans.map((span) => normalizeText($(span).text())).findLast(timestampText) ?? null;
    const timestampIso = timestampRaw && !Number.isNaN(Date.parse(timestampRaw)) ? new Date(timestampRaw).toISOString() : null;
    const avatarUrl = avatarUrlForNode(node, avatarUrls);
    const speakerColor = speakerSpan ? inlineColor($(speakerSpan).attr("style")) : null;
    const content = node.clone();
    content.find(".who, .pic, .msg-actions, .msg-edit, .msg-chan, .mk-script-lock").remove();
    const body = content.find(".body").first();
    const contentHtml = body.length ? body.html() ?? "" : content.html() ?? "";
    const parsed = parseRichHtml(contentHtml, `takoyaki:${sourceKey}:${sourceOrder}`);
    const recordWarnings = parsed.warnings.map((warning) => ({ ...warning, sourceMessageId: sourceKey }));
    warnings.push(...recordWarnings);
    const document: LogEntryDocument = {
      version: 2,
      kind: messageType === "message" ? "dialogue" : messageType === "narration" || messageType === "script" ? "description" : "system",
      source: {
        platform: "takoyaki-box", messageId: sourceKey, sourceKey, sourceOrder,
        stream: { id: streamId, name: streamName(streamId, displayedStream) }, messageType
      },
      speaker: speakerName || avatarUrl ? { name: speakerName, color: speakerColor, avatarUrl } : null,
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
