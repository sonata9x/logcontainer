import * as cheerio from "cheerio";
import { ROLL20_HEADER_SELECTOR } from "./generated-ui";

export type RenderedRecordMetadata = {
  avatarUrl: string | null;
  color: string | null;
  speakerName: string | null;
  speakerExplicit: boolean;
  avatarExplicit: boolean;
  timestampExplicit: boolean;
  selfMessage: boolean;
  timestampRaw: string | null;
  timestampIso: string | null;
};

export type Roll20SourceRecord = {
  origin: "msgdata" | "rendered";
  sourceKey: string;
  sourceOrder: number;
  priority: number;
  messageId: string | null;
  type: string;
  who: string | null;
  content: string;
  htmlContent: string;
  inlinerolls: unknown[];
  rolltemplate: string | null;
  renderedHtml: string | null;
  structuralLane: string | null;
  alternateHtml: string[];
  renderedMetadata: RenderedRecordMetadata | null;
  semanticPayload: string | null;
  headerScore: number;
  streamId: string | null;
};

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() : "";
}

function objectContentToString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value)) return value.map(objectContentToString).filter(Boolean).join(" ");
  const record = value as Record<string, unknown>;
  for (const key of ["content", "html", "htmlcontent", "innerHTML", "value", "text"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key];
  }
  return Object.values(record).map(objectContentToString).filter(Boolean).join(" ");
}

export function decodeRoll20MsgData(source: string): Roll20SourceRecord[] | null {
  const encoded = source.match(/var\s+msgdata\s*=\s*["']([^"']+)["']\s*;/)?.[1];
  if (!encoded) return null;
  const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as unknown;
  if (!Array.isArray(decoded)) throw new Error("Invalid Roll20 msgdata payload.");
  let ordinal = 0;
  return decoded.flatMap((group) => {
    if (!group || typeof group !== "object" || Array.isArray(group)) return [];
    return Object.entries(group).flatMap(([sourceKey, sourceValue]) => {
      if (!sourceValue || typeof sourceValue !== "object" || Array.isArray(sourceValue)) return [];
      const value = sourceValue as Record<string, unknown>;
      const record: Roll20SourceRecord = {
        origin: "msgdata",
        sourceKey,
        sourceOrder: ordinal++,
        priority: typeof value[".priority"] === "number" ? value[".priority"] : ordinal,
        messageId: normalizeText(value.messageId ?? sourceKey) || null,
        type: normalizeText(value.type) || "general",
        who: normalizeText(value.who) || null,
        content: typeof value.content === "string" ? value.content : "",
        htmlContent: objectContentToString(value.htmlcontent),
        inlinerolls: Array.isArray(value.inlinerolls) ? value.inlinerolls : [],
        rolltemplate: normalizeText(value.rolltemplate) || null,
        renderedHtml: null,
        structuralLane: null,
        alternateHtml: []
        ,renderedMetadata: null
        ,semanticPayload: null
        ,headerScore: 0
        ,streamId: normalizeText(value["data-tab-id"] ?? value.dataTabId ?? value.tabId) || null
      };
      return [record];
    });
  }).sort((a, b) => a.priority - b.priority || a.sourceOrder - b.sourceOrder);
}

function structuralLane($: cheerio.CheerioAPI, element: Parameters<cheerio.CheerioAPI>[0]) {
  const parts: string[] = [];
  let parent = $(element).parent();
  while (parent.length && parts.length < 6) {
    const id = parent.attr("id");
    const classes = String(parent.attr("class") ?? "").split(/\s+/).filter(Boolean).sort().join(".");
    parts.push(`${parent.prop("tagName") ?? "node"}${id ? `#${id}` : ""}${classes ? `.${classes}` : ""}`);
    parent = parent.parent();
  }
  return parts.join(">");
}

export function extractRenderedRoll20(source: string): Roll20SourceRecord[] {
  const $ = cheerio.load(source);
  const elements = $(".message").filter((_index, element) => $(element).parents(".message").length === 0).toArray();
  if (!elements.length) throw new Error("Roll20 message elements were not found.");
  return elements.map((element, index) => {
    const node = $(element);
    const speaker = node.find(".by, .speaker, .author, .username, .name, .message-sender, .byline").first().text().replace(/[:：]\s*$/, "").trim() || null;
    const avatarValue = node.find(".avatar img, .character-avatar img, img.avatar, img.character-avatar").first().attr("src");
    let avatarUrl: string | null = null;
    try { if (avatarValue) { const url = new URL(avatarValue); if (url.protocol === "https:") avatarUrl = url.href; } } catch {}
    const speakerStyle = node.find(".by, .speaker").first().attr("style") ?? "";
    const color = speakerStyle.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1]?.trim() ?? null;
    const timestampRaw = node.find(".tstamp, .timestamp, time").first().text().trim() || null;
    const timestampIso = timestampRaw && !Number.isNaN(Date.parse(timestampRaw)) ? new Date(timestampRaw).toISOString() : null;
    const content = node.clone();
    content.find(ROLL20_HEADER_SELECTOR).remove();
    const semanticText = content.text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    const images = content.find("img[src]").toArray().map((item) => $(item).attr("src") ?? "");
    const rolls = content.find(".inlinerollresult").toArray().map((item) => `${$(item).text().trim()}@${$(item).attr("title") ?? ""}`);
    const templates = content.find("[class*='sheet-rolltemplate-']").toArray().map((item) => $(item).attr("class") ?? "");
    const semanticPayload = [semanticText, ...images, ...rolls, ...templates].filter(Boolean).join("\n");
    const metadata: RenderedRecordMetadata = {
      avatarUrl, color, speakerName: speaker, speakerExplicit: Boolean(speaker),
      avatarExplicit: Boolean(avatarValue), timestampExplicit: Boolean(timestampRaw),
      selfMessage: node.hasClass("you"), timestampRaw, timestampIso
    };
    return {
      origin: "rendered" as const,
      sourceKey: `rendered-${index}`,
      sourceOrder: index,
      priority: index,
      messageId: normalizeText(node.attr("data-messageid")) || null,
      type: String(node.attr("class") ?? "").split(/\s+/).find((name) => ["general", "desc", "emote", "system", "hidden-message"].includes(name)) ?? "general",
      who: speaker,
      content: "",
      htmlContent: "",
      inlinerolls: [],
      rolltemplate: null,
      renderedHtml: $.html(element),
      structuralLane: structuralLane($, element),
      alternateHtml: []
      ,renderedMetadata: metadata
      ,semanticPayload
      ,headerScore: Number(Boolean(speaker)) * 4 + Number(Boolean(avatarValue)) * 2 + Number(Boolean(timestampRaw))
      ,streamId: normalizeText(node.attr("data-tab-id")) || null
    };
  });
}

export function detectRoll20Source(source: string) {
  const msgdata = decodeRoll20MsgData(source);
  if (!msgdata) return { format: "rendered_html_fragment" as const, records: extractRenderedRoll20(source), renderedRecords: [] as Roll20SourceRecord[] };
  let renderedRecords: Roll20SourceRecord[] = [];
  try { renderedRecords = extractRenderedRoll20(source); } catch {}
  return { format: "msgdata" as const, records: msgdata, renderedRecords };
}
