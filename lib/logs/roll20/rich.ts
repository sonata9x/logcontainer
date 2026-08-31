import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import type { ParserWarning, RichNode } from "@/lib/logs/model/types";
import { sanitizeRichStyle } from "@/lib/logs/rich/style";
import { stableRoll20Id } from "./id";
import { inlineRollFromSource } from "./inline-roll";
import { isRoll20GeneratedSubtree } from "./generated-ui";

const SAFE_TAGS = new Set(["span", "div", "p", "strong", "em", "small", "u", "s", "blockquote", "code", "pre", "a"]);
const DROP_TAGS = new Set(["script", "style", "iframe", "object", "embed", "svg", "math", "form", "input", "button", "textarea", "select", "link", "meta"]);

export type RichParseResult = {
  nodes: RichNode[];
  warnings: ParserWarning[];
  sanitizedStyleCount: number;
  droppedStyleCount: number;
  unknownFallbackCount: number;
};

function safeHttpsUrl(value: string | undefined) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

function safeImageUrl(value: string | undefined) {
  const https = safeHttpsUrl(value);
  if (https) return https;
  if (!value || value.length > 5_000_000) return null;
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\r\n]+$/i.test(value) ? value : null;
}

export function parseRichHtml(html: string, seed: string): RichParseResult {
  const $ = cheerio.load(html, null, false);
  const warnings: ParserWarning[] = [];
  let sanitizedStyleCount = 0;
  let droppedStyleCount = 0;
  let unknownFallbackCount = 0;

  function parseNode(node: AnyNode, path: string): RichNode[] {
    if (node.type === "text") return node.data ? [{ id: stableRoll20Id("richtext", seed, path, node.data), type: "text", text: node.data }] : [];
    if (node.type !== "tag") return [];
    const element = node as Element;
    const tagName = element.name.toLowerCase();
    const wrapped = $(element);
    if (DROP_TAGS.has(tagName)) {
      warnings.push({ code: "dropped-rich-tag", message: `안전하지 않은 <${tagName}> 요소를 제거했습니다.`, path });
      unknownFallbackCount += 1;
      return [];
    }
    if (tagName === "br") return [{ id: stableRoll20Id("break", seed, path), type: "break" }];
    const classValue = wrapped.attr("class") ?? "";
    if (/(?:^|\s)inlinerollresult(?:\s|$)/.test(classValue)) {
      const value = wrapped.text().trim();
      const index = Number(wrapped.attr("data-roll-index") ?? 0);
      return [{ id: stableRoll20Id("richroll", seed, path, value), type: "inline-roll", roll: inlineRollFromSource(undefined, index, `${seed}:${path}`, classValue, value, wrapped.attr("title")) }];
    }
    if (isRoll20GeneratedSubtree(classValue)) {
      return element.children.flatMap((child, index) => parseNode(child, `${path}.${index}`));
    }
    const styleResult = sanitizeRichStyle(wrapped.attr("style") ?? "");
    sanitizedStyleCount += styleResult.sanitizedCount;
    droppedStyleCount += styleResult.droppedCount;
    warnings.push(...styleResult.warnings.map((detail) => ({ code: "sanitized-style", message: "Rich content 스타일을 정리했습니다.", path, detail })));
    if (tagName === "img") {
      const src = safeImageUrl(wrapped.attr("src"));
      if (!src) {
        warnings.push({ code: "dropped-rich-image", message: "안전하지 않은 Rich content 이미지를 제거했습니다.", path, detail: wrapped.attr("src") ?? null });
        return [];
      }
      const parentHref = element.parent?.type === "tag" && (element.parent as Element).name === "a" ? safeHttpsUrl($(element.parent).attr("href")) : null;
      return [{ id: stableRoll20Id("richimage", seed, path, src), type: "image", src, href: parentHref, alt: wrapped.attr("alt") ?? null, style: styleResult.style }];
    }
    const children = element.children.flatMap((child, index) => parseNode(child, `${path}.${index}`));
    let tag = SAFE_TAGS.has(tagName) ? tagName as Extract<RichNode, { type: "element" }>["tag"] : "span";
    if (!SAFE_TAGS.has(tagName)) {
      unknownFallbackCount += 1;
      warnings.push({ code: "unknown-rich-tag", message: `<${tagName}> 요소를 안전한 span fallback으로 보존했습니다.`, path });
    }
    const href = tag === "a" ? safeHttpsUrl(wrapped.attr("href")) : null;
    if (tag === "a" && !href) tag = "span";
    return [{ id: stableRoll20Id("element", seed, path, tagName), type: "element", tag, href, title: wrapped.attr("title")?.slice(0, 500) ?? null, style: styleResult.style, children }];
  }

  const nodes = $.root().contents().toArray().flatMap((node, index) => parseNode(node, String(index)));
  return { nodes, warnings, sanitizedStyleCount, droppedStyleCount, unknownFallbackCount };
}
