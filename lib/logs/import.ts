import * as cheerio from "cheerio";
import type { LogEntry } from "@/lib/types";
import { containsMarkdownImage, objectContentToString, roll20ContentToHtml, roll20ContentToText } from "./roll20-content";

export type ImportedEntry = Pick<
  LogEntry,
  "order_index" | "entry_type" | "speaker_name" | "speaker_color" | "content" | "original_content" | "raw_html" | "metadata"
>;

type Roll20Message = {
  ".priority"?: number;
  content?: string;
  htmlcontent?: unknown;
  inlinerolls?: unknown[];
  messageId?: string;
  rolltemplate?: string;
  type?: string;
  who?: string;
};

type SourceMessage = {
  messageId: string | null;
  priority: number;
  message: Roll20Message;
};

export type Roll20ImportReport = {
  provider: "roll20";
  sourceFormat: "msgdata" | "rendered_html_fragment";
  importedAt: string;
  sourceMessageCount: number;
  importedMessageCount: number;
  hiddenMessageCount: number;
  duplicateMessageCount: number;
  duplicateMessageIds: string[];
};

export type Roll20ImportOptions = {
  removeHiddenMessages?: boolean;
  removeDuplicateMessages?: boolean;
};

function normalizeText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function entryType(message: Roll20Message): ImportedEntry["entry_type"] {
  if (containsMarkdownImage(message.content ?? "")) return "image";
  if (message.rolltemplate || message.inlinerolls?.length || /roll/i.test(message.type ?? "")) return "dice";
  if (["desc", "emote", "error"].includes(message.type ?? "")) return "system";
  return "dialogue";
}

function decodeMsgData(source: string): SourceMessage[] | null {
  const encoded = source.match(/var\s+msgdata\s*=\s*["']([^"']+)["']\s*;/)?.[1];
  if (!encoded) return null;
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
  if (!Array.isArray(decoded)) throw new Error("Invalid Roll20 msgdata payload.");

  return decoded.flatMap((group) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    return Object.entries(group).flatMap(([objectKey, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const message = value as Roll20Message;
      return [{
        messageId: normalizeText(message.messageId ?? objectKey) || null,
        priority: typeof message[".priority"] === "number" ? message[".priority"] : 0,
        message
      }];
    });
  }).sort((a, b) => a.priority - b.priority);
}

function cleanMessages<T extends { messageId: string | null; hidden: boolean }>(messages: T[], options: Roll20ImportOptions) {
  const seen = new Set<string>();
  const duplicateMessageIds: string[] = [];
  let hiddenMessageCount = 0;

  const kept = messages.filter((item) => {
    if (options.removeHiddenMessages && item.hidden) {
      hiddenMessageCount += 1;
      return false;
    }
    if (!options.removeDuplicateMessages || !item.messageId) return true;
    if (seen.has(item.messageId)) {
      duplicateMessageIds.push(item.messageId);
      return false;
    }
    seen.add(item.messageId);
    return true;
  });

  return { kept, hiddenMessageCount, duplicateMessageIds };
}

function parseMsgData(sourceMessages: SourceMessage[], options: Roll20ImportOptions) {
  const cleanup = cleanMessages(sourceMessages.map((source) => ({
    ...source,
    hidden: source.message.type === "hidden"
  })), options);

  const entries = cleanup.kept.map(({ message, messageId }, orderIndex): ImportedEntry => {
    const speaker = normalizeText(message.who ?? "") || null;
    const sourceContent = typeof message.content === "string" ? message.content : objectContentToString(message.htmlcontent);
    const inlineRolls = Array.isArray(message.inlinerolls) ? message.inlinerolls : [];
    const messageHtml = roll20ContentToHtml(sourceContent, inlineRolls);
    const fullText = roll20ContentToText(sourceContent, inlineRolls);
    const text = speaker ? fullText.replace(new RegExp(`^${escapeRegex(speaker)}\\s*[:：]?\\s*`), "") : fullText;
    const rawHtml = `<div class="message ${escapeHtml(message.type ?? "general")}"${messageId ? ` data-messageid="${escapeHtml(messageId)}"` : ""}>${speaker ? `<strong class="by">${escapeHtml(speaker)}</strong> ` : ""}<span class="content">${messageHtml}</span></div>`;
    return {
      order_index: orderIndex,
      entry_type: entryType(message),
      speaker_name: speaker,
      speaker_color: null,
      content: text,
      original_content: text,
      raw_html: rawHtml,
      metadata: { roll20Type: message.type ?? null, roll20MessageId: messageId, inlinerolls: inlineRolls }
    };
  });

  return { entries, cleanup, sourceCount: sourceMessages.length };
}

function parseRenderedFragment(source: string, options: Roll20ImportOptions) {
  const $ = cheerio.load(source);
  const sourceElements = $(".message").toArray();
  if (!sourceElements.length) throw new Error("Roll20 message elements were not found.");

  const cleanup = cleanMessages(sourceElements.map((element) => {
    const node = $(element);
    return {
      element,
      messageId: normalizeText(node.attr("data-messageid") ?? "") || null,
      hidden: node.hasClass("hidden-message")
    };
  }), options);

  const entries = cleanup.kept.map(({ element, messageId }, orderIndex): ImportedEntry => {
    const node = $(element);
    node.find(".avatar, .character-avatar, img.avatar, img.character-avatar, [aria-hidden='true']").remove();
    node.find("[hidden], script, style, noscript").remove();
    node.find("[style]").each((_index, child) => {
      const style = String($(child).attr("style") ?? "").toLowerCase();
      if (style.includes("display:none") || style.includes("visibility:hidden")) $(child).remove();
    });
    const speakerNode = node.find(".by, .speaker, .author, .username, .name, .message-sender, .byline").first();
    const speaker = normalizeText(speakerNode.text()).replace(/[:：]\s*$/, "") || null;
    const clone = node.clone();
    clone.find(".avatar, .character-avatar, .tstamp, time, .timestamp, [aria-hidden='true'], [hidden]").remove();
    if (speaker) clone.find(".by, .speaker, .author, .username, .name, .message-sender, .byline").first().remove();
    const text = normalizeText(clone.text());
    const classes = String(node.attr("class") ?? "");

    return {
      order_index: orderIndex,
      entry_type: /roll|dice|inlineroll/i.test(classes) ? "dice" : /desc|emote|system/i.test(classes) ? "system" : node.find("img").length ? "image" : "dialogue",
      speaker_name: speaker,
      speaker_color: null,
      content: text,
      original_content: text,
      raw_html: $.html(element),
      metadata: { roll20MessageId: messageId }
    };
  });

  return { entries, cleanup, sourceCount: sourceElements.length };
}

export function importRoll20Html(source: string, options: Roll20ImportOptions = {}) {
  const sourceMessages = decodeMsgData(source);
  const parsed = sourceMessages ? parseMsgData(sourceMessages, options) : parseRenderedFragment(source, options);
  const sourceMessageCount = parsed.sourceCount;
  const report: Roll20ImportReport = {
    provider: "roll20",
    sourceFormat: sourceMessages ? "msgdata" : "rendered_html_fragment",
    importedAt: new Date().toISOString(),
    sourceMessageCount,
    importedMessageCount: parsed.entries.length,
    hiddenMessageCount: parsed.cleanup.hiddenMessageCount,
    duplicateMessageCount: parsed.cleanup.duplicateMessageIds.length,
    duplicateMessageIds: parsed.cleanup.duplicateMessageIds
  };

  return { platform: "roll20" as const, entries: parsed.entries, report };
}
