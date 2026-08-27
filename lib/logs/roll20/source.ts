import * as cheerio from "cheerio";

export type Roll20SourceRecord = {
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
    return {
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
    };
  });
}

export function detectRoll20Source(source: string) {
  const msgdata = decodeRoll20MsgData(source);
  return msgdata ? { format: "msgdata" as const, records: msgdata } : { format: "rendered_html_fragment" as const, records: extractRenderedRoll20(source) };
}
