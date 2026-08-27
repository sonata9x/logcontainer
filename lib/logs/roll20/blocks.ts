import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { ImageBlock, LogBlock, ParserWarning, RichBlock, RichNode } from "@/lib/logs/model/types";
import { isRollTemplateClass, ROLL20_HEADER_SELECTOR } from "./generated-ui";
import { stableRoll20Id } from "./id";
import { inlineRollFromSource } from "./inline-roll";
import { parseRichHtml, type RichParseResult } from "./rich";
import { enrichRollTemplateFromRendered, parseRenderedRollTemplate, parseRollTemplate } from "./roll-template";
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
      if (href && isImage) blocks.push({ id: stableRoll20Id("image", seed, href), type: "image", src: href, href, alt: match[2] || null, caption: null });
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
  return {
    id: stableRoll20Id("image", seed, path, src), type: "image", src,
    href: safeHttpsUrl(anchor.attr("href")), alt: image.attr("alt") ?? null,
    caption: wrapped.find("figcaption").first().text().trim() || null,
    display: { width: image.attr("width") ?? null, height: image.attr("height") ?? null, maxWidth: null, minWidth: null, align: null }
  };
}

function addRichStats(result: BlockParseResult, rich: RichParseResult) {
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
    const templateName = record.rolltemplate ?? String(template.attr("class") ?? "").split(/\s+/).find((name) => name.startsWith("sheet-rolltemplate-"))?.replace("sheet-rolltemplate-", "") ?? null;
    if (record.rolltemplate || /&\{template:[^}]+}/i.test(record.content)) {
      const base = parseRollTemplate({ content: record.content || record.htmlContent, template: templateName, inlinerolls: record.inlinerolls, seed });
      result.blocks.push(enrichRollTemplateFromRendered(base, $.html(template), `${seed}:rendered`));
    } else result.blocks.push(parseRenderedRollTemplate($.html(template), templateName, seed));
    return result;
  }

  let richNodes: RichNode[] = [];
  let richStartPath = "";
  let renderedRollIndex = 0;
  function flushRich() {
    if (!richNodes.length) return;
    result.blocks.push({ id: stableRoll20Id("rich", seed, richStartPath, richNodes.map((node) => node.id)), type: "rich", nodes: richNodes } satisfies RichBlock);
    richNodes = [];
    richStartPath = "";
  }
  function appendRich(rich: RichParseResult, path: string) {
    if (!richStartPath) richStartPath = path;
    richNodes.push(...rich.nodes);
    addRichStats(result, rich);
  }
  function appendText(text: string, path: string) {
    if (!text) return;
    if (richNodes.length) richNodes.push({ id: stableRoll20Id("richtext", seed, path, text), type: "text", text });
    else result.blocks.push({ id: stableRoll20Id("text", seed, path, text), type: "text", text });
  }
  function walk(node: AnyNode, path: string) {
    if (node.type === "text") { appendText(node.data, path); return; }
    if (node.type !== "tag") return;
    const element = node as Element;
    const wrapped = $(element);
    const classes = wrapped.attr("class") ?? "";
    if (element.name === "br") { appendText("\n", path); return; }
    if (/(?:^|\s)inlinerollresult(?:\s|$)/.test(classes)) {
      const roll = inlineRollFromSource(record.inlinerolls[renderedRollIndex], renderedRollIndex, seed, classes, wrapped.text(), wrapped.attr("title"));
      renderedRollIndex += 1;
      if (richNodes.length) richNodes.push({ id: stableRoll20Id("richroll", seed, path, roll.id), type: "inline-roll", roll });
      else result.blocks.push(roll);
      return;
    }
    const image = imageFromElement($, element, seed, path);
    const onlyImage = image && wrapped.clone().find("img,figcaption").remove().end().text().trim() === "";
    if (image && onlyImage) { flushRich(); result.blocks.push(image); return; }
    const hasRichPresentation = Boolean(wrapped.attr("style")) || Boolean(classes) || !["span", "div", "p"].includes(element.name);
    if (!hasRichPresentation) {
      element.children.forEach((child, index) => walk(child, `${path}.${index}`));
      return;
    }
    appendRich(parseRichHtml($.html(element), `${seed}:${path}`), path);
  }

  root.contents().toArray().forEach((node, index) => walk(node, String(index)));
  flushRich();
  for (const [index, alternate] of record.alternateHtml.entries()) {
    result.warnings.push({ code: "structural-content-mismatch", message: "같은 Roll20 message ID의 다른 DOM 내용을 Rich fallback으로 보존했습니다.", sourceMessageId: record.messageId });
    const alternateDom = cheerio.load(alternate, null, false);
    const alternateRoot = alternateDom(".message").first();
    alternateRoot.find(ROLL20_HEADER_SELECTOR).remove();
    const alternateRich = parseRichHtml(alternateRoot.html() ?? "", `${seed}:alternate:${index}`);
    if (alternateRich.nodes.length) result.blocks.push({ id: stableRoll20Id("rich", seed, `alternate:${index}`), type: "rich", nodes: alternateRich.nodes });
    addRichStats(result, alternateRich);
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
      const clone = $(roots[0]).clone(); clone.find("img,figcaption").remove();
      if (image && !clone.text().trim()) { result.blocks.push(image); return result; }
    }
    const rich = parseRichHtml(content, seed);
    if (rich.nodes.length) result.blocks.push({ id: stableRoll20Id("rich", seed, "root"), type: "rich", nodes: rich.nodes });
    addRichStats(result, rich);
    return result;
  }
  result.blocks.push(...markdownAndRollBlocks(content, record, seed));
  return result;
}
