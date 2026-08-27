import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { ImageBlock, LogBlock, ParserWarning, RichBlock } from "@/lib/logs/model/types";
import { isRollTemplateClass, ROLL20_HEADER_SELECTOR } from "./generated-ui";
import { stableRoll20Id } from "./id";
import { inlineRollFromSource } from "./inline-roll";
import { parseRichHtml, type RichParseResult } from "./rich";
import { parseRollTemplate } from "./roll-template";
import type { Roll20SourceRecord } from "./source";

export type BlockParseResult = {
  blocks: LogBlock[];
  warnings: ParserWarning[];
  sanitizedStyleCount: number;
  droppedStyleCount: number;
  unknownFallbackCount: number;
};

function safeHttpsUrl(value: string | undefined) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

function markdownAndRollBlocks(content: string, record: Roll20SourceRecord, seed: string): LogBlock[] {
  const source = content.replace(/^\s*\/desc\s*/i, "");
  const blocks: LogBlock[] = [];
  const pattern = /\$\[\[(\d+)]]|\[([^\]]*)]\((https?:\/\/[^)\s]+)\)/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ id: stableRoll20Id("text", seed, cursor, source.slice(cursor, index)), type: "text", text: source.slice(cursor, index) });
    if (match[1] != null) {
      const rollIndex = Number(match[1]);
      blocks.push(inlineRollFromSource(record.inlinerolls[rollIndex], rollIndex, seed));
    } else {
      const href = safeHttpsUrl(match[3]);
      const isImage = href && /\.(?:png|jpe?g|gif|webp|avif)(?:$|\?)/i.test(href);
      if (href && isImage) blocks.push({ id: stableRoll20Id("image", seed, href), type: "image", src: href, href, alt: match[2] || null });
      else blocks.push({ id: stableRoll20Id("text", seed, index, match[0]), type: "text", text: match[2] || match[0] });
    }
    cursor = index + match[0].length;
  }
  if (cursor < source.length) blocks.push({ id: stableRoll20Id("text", seed, cursor, source.slice(cursor)), type: "text", text: source.slice(cursor) });
  if (!blocks.length && source) blocks.push({ id: stableRoll20Id("text", seed, source), type: "text", text: source });
  return blocks;
}

function imageFromElement($: cheerio.CheerioAPI, element: Element, seed: string, path: string): ImageBlock | null {
  const wrapped = $(element);
  const image = element.name === "img" ? wrapped : wrapped.find("img").first();
  if (!image.length) return null;
  const src = safeHttpsUrl(image.attr("src"));
  if (!src) return null;
  const anchor = element.name === "a" ? wrapped : image.closest("a");
  return { id: stableRoll20Id("image", seed, path, src), type: "image", src, href: safeHttpsUrl(anchor.attr("href")), alt: image.attr("alt") ?? (wrapped.find("figcaption").first().text().trim() || null), display: { width: image.attr("width") ?? null, height: image.attr("height") ?? null, maxWidth: null, minWidth: null, align: null } };
}

function appendRich(result: BlockParseResult, rich: RichParseResult, seed: string, path: string) {
  if (rich.nodes.length) result.blocks.push({ id: stableRoll20Id("rich", seed, path), type: "rich", nodes: rich.nodes } satisfies RichBlock);
  result.warnings.push(...rich.warnings);
  result.sanitizedStyleCount += rich.sanitizedStyleCount;
  result.droppedStyleCount += rich.droppedStyleCount;
  result.unknownFallbackCount += rich.unknownFallbackCount;
}

function parseRenderedRecord(record: Roll20SourceRecord, seed: string): BlockParseResult {
  const result: BlockParseResult = { blocks: [], warnings: [], sanitizedStyleCount: 0, droppedStyleCount: 0, unknownFallbackCount: 0 };
  const $ = cheerio.load(record.renderedHtml ?? "", null, false);
  const root = $(".message").first();
  root.find(ROLL20_HEADER_SELECTOR).remove();
  const template = root.find("[class*='sheet-rolltemplate-']").first();
  if (template.length && isRollTemplateClass(template.attr("class"))) {
    const templateName = String(template.attr("class") ?? "").split(/\s+/).find((name) => name.startsWith("sheet-rolltemplate-"))?.replace("sheet-rolltemplate-", "") ?? null;
    const fields = template.find("tr").toArray().map((row) => {
      const label = $(row).find(".sheet-template_label, th, td:first-child").first().text().trim();
      const value = $(row).find(".sheet-template_value, td:last-child").last().text().trim();
      return label ? `{{${label}=${value}}}` : "";
    }).join(" ");
    result.blocks.push(parseRollTemplate({ content: `{{name=${template.find("caption").first().text().trim()}}} ${fields}`, template: templateName, inlinerolls: [], seed }));
    return result;
  }

  function walk(node: AnyNode, path: string) {
    if (node.type === "text") {
      if (node.data) result.blocks.push({ id: stableRoll20Id("text", seed, path, node.data), type: "text", text: node.data });
      return;
    }
    if (node.type !== "tag") return;
    const element = node as Element;
    const wrapped = $(element);
    const classes = wrapped.attr("class") ?? "";
    if (/(?:^|\s)inlinerollresult(?:\s|$)/.test(classes)) {
      result.blocks.push(inlineRollFromSource(undefined, result.blocks.length, seed, classes, wrapped.text()));
      return;
    }
    const image = imageFromElement($, element, seed, path);
    const onlyImage = image && wrapped.clone().find("img").remove().end().text().trim() === "";
    if (image && onlyImage) { result.blocks.push(image); return; }
    if (!wrapped.attr("style") && !classes && ["span", "div", "p"].includes(element.name)) {
      element.children.forEach((child, index) => walk(child, `${path}.${index}`));
      return;
    }
    appendRich(result, parseRichHtml($.html(element), `${seed}:${path}`), seed, path);
  }

  root.contents().toArray().forEach((node, index) => walk(node, String(index)));
  for (const [index, alternate] of record.alternateHtml.entries()) {
    result.warnings.push({ code: "structural-content-mismatch", message: "같은 Roll20 message ID의 다른 DOM 내용을 Rich fallback으로 보존했습니다.", sourceMessageId: record.messageId });
    appendRich(result, parseRichHtml(alternate, `${seed}:alternate:${index}`), seed, `alternate:${index}`);
  }
  return result;
}

export function parseRoll20Blocks(record: Roll20SourceRecord): BlockParseResult {
  const seed = `${record.sourceKey}:${record.messageId ?? "none"}:${record.sourceOrder}`;
  if (record.renderedHtml) return parseRenderedRecord(record, seed);
  const result: BlockParseResult = { blocks: [], warnings: [], sanitizedStyleCount: 0, droppedStyleCount: 0, unknownFallbackCount: 0 };
  const content = record.content || record.htmlContent;
  if (record.rolltemplate || /&\{template:[^}]+}/i.test(content)) {
    const template = record.rolltemplate ?? content.match(/&\{template:([^}]+)}/i)?.[1]?.trim() ?? null;
    result.blocks.push(parseRollTemplate({ content, template, inlinerolls: record.inlinerolls, seed }));
    return result;
  }
  if (/<\/?[a-z][\s\S]*>/i.test(content)) {
    const $ = cheerio.load(content, null, false);
    const roots = $.root().children().toArray();
    if (roots.length === 1) {
      const image = imageFromElement($, roots[0] as Element, seed, "0");
      const clone = $(roots[0]).clone(); clone.find("img").remove();
      if (image && !clone.text().trim()) { result.blocks.push(image); return result; }
    }
    appendRich(result, parseRichHtml(content, seed), seed, "root");
    return result;
  }
  result.blocks.push(...markdownAndRollBlocks(content, record, seed));
  return result;
}
