import { sanitizeRichStyleDeclarations } from "@/lib/logs/rich/style";
import type { LogBlock, LogEntryDocument, ParserWarning, RichNode } from "./types";

const KINDS = new Set(["dialogue", "description", "system"]);
const BLOCK_TYPES = new Set(["text", "rich", "image", "inline-roll", "roll-template"]);

function safeHttpsUrl(value: unknown, nullable = true): string | null {
  if (value == null && nullable) return null;
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

function sanitizeRichNode(node: unknown, warnings: ParserWarning[], path: string): RichNode | null {
  if (!node || typeof node !== "object") { warnings.push({ code: "invalid-document-node", message: "유효하지 않은 RichNode입니다.", path }); return null; }
  const value = node as Record<string, unknown>;
  const id = typeof value.id === "string" && value.id ? value.id : null;
  if (!id || typeof value.type !== "string") { warnings.push({ code: "invalid-document-node", message: "RichNode ID 또는 type이 없습니다.", path }); return null; }
  if (value.type === "text") return typeof value.text === "string" ? { id, type: "text", text: value.text } : null;
  if (value.type === "break") return { id, type: "break" };
  if (value.type === "image") {
    const src = safeHttpsUrl(value.src, false);
    if (!src) { warnings.push({ code: "dropped-rich-image", message: "안전하지 않은 Rich 이미지 URL을 제거했습니다.", path }); return null; }
    const styleResult = sanitizeRichStyleDeclarations(value.style);
    warnings.push(...styleResult.warnings.map((detail) => ({ code: "sanitized-style", message: "Rich 이미지 스타일을 정리했습니다.", path, detail })));
    return { id, type: "image", src, href: safeHttpsUrl(value.href), alt: typeof value.alt === "string" ? value.alt : null, style: styleResult.style };
  }
  if (value.type === "inline-roll") {
    const roll = sanitizeBlock(value.roll, warnings, `${path}.roll`);
    return roll?.type === "inline-roll" ? { id, type: "inline-roll", roll } : null;
  }
  if (value.type !== "element") return null;
  const tags = new Set(["span", "div", "p", "strong", "em", "small", "u", "s", "blockquote", "code", "pre", "a"]);
  const tag = typeof value.tag === "string" && tags.has(value.tag) ? value.tag as Extract<RichNode, { type: "element" }>["tag"] : "span";
  const styleResult = sanitizeRichStyleDeclarations(value.style);
  warnings.push(...styleResult.warnings.map((detail) => ({ code: "sanitized-style", message: "Rich 요소 스타일을 정리했습니다.", path, detail })));
  const children = Array.isArray(value.children) ? value.children.map((child, index) => sanitizeRichNode(child, warnings, `${path}.children[${index}]`)).filter((child): child is RichNode => Boolean(child)) : [];
  const href = tag === "a" ? safeHttpsUrl(value.href) : null;
  return { id, type: "element", tag: tag === "a" && !href ? "span" : tag, href, title: typeof value.title === "string" ? value.title.slice(0, 500) : null, style: styleResult.style, children };
}

function sanitizeBlock(block: unknown, warnings: ParserWarning[], path: string): LogBlock | null {
  if (!block || typeof block !== "object") { warnings.push({ code: "invalid-document-node", message: "유효하지 않은 block입니다.", path }); return null; }
  const value = block as Record<string, unknown>;
  if (typeof value.id !== "string" || !value.id || typeof value.type !== "string" || !BLOCK_TYPES.has(value.type)) { warnings.push({ code: "invalid-document-node", message: "block ID 또는 type이 유효하지 않습니다.", path }); return null; }
  const id = value.id;
  if (value.type === "text") return typeof value.text === "string" ? { id, type: "text", text: value.text } : null;
  if (value.type === "inline-roll") return {
    id, type: "inline-roll", value: String(value.value ?? ""), expression: typeof value.expression === "string" ? value.expression : null,
    state: ["normal", "critical", "fumble", "important"].includes(String(value.state)) ? value.state as "normal" | "critical" | "fumble" | "important" : null,
    tooltip: typeof value.tooltip === "string" ? value.tooltip : null, rawFormula: typeof value.rawFormula === "string" ? value.rawFormula : null
  };
  if (value.type === "image") {
    const src = safeHttpsUrl(value.src, false);
    if (!src) { warnings.push({ code: "dropped-image", message: "안전하지 않은 이미지 URL을 제거했습니다.", path }); return null; }
    const display = value.display && typeof value.display === "object" ? value.display as Record<string, unknown> : {};
    return { id, type: "image", src, href: safeHttpsUrl(value.href), alt: typeof value.alt === "string" ? value.alt : null, display: {
      width: typeof display.width === "string" ? display.width : null, height: typeof display.height === "string" ? display.height : null,
      minWidth: typeof display.minWidth === "string" ? display.minWidth : null, maxWidth: typeof display.maxWidth === "string" ? display.maxWidth : null,
      align: ["left", "center", "right"].includes(String(display.align)) ? display.align as "left" | "center" | "right" : null
    } };
  }
  if (value.type === "rich") {
    const nodes = Array.isArray(value.nodes) ? value.nodes.map((node, index) => sanitizeRichNode(node, warnings, `${path}.nodes[${index}]`)).filter((node): node is RichNode => Boolean(node)) : [];
    return { id, type: "rich", nodes };
  }
  const fields = Array.isArray(value.fields) ? value.fields.flatMap((field, index) => {
    if (!field || typeof field !== "object") return [];
    const item = field as Record<string, unknown>;
    if (typeof item.id !== "string") return [];
    const content = Array.isArray(item.content) ? item.content.map((child, childIndex) => sanitizeBlock(child, warnings, `${path}.fields[${index}].content[${childIndex}]`)).filter((child): child is Extract<LogBlock, { type: "text" | "inline-roll" }> => child?.type === "text" || child?.type === "inline-roll") : [];
    return [{ id: item.id, key: String(item.key ?? ""), label: String(item.label ?? item.key ?? ""), value: String(item.value ?? ""), content }];
  }) : [];
  const level = ["critical", "extreme", "hard", "success", "failure", "fumble"].includes(String(value.resultLevel)) ? value.resultLevel as Extract<LogBlock, { type: "roll-template" }>["resultLevel"] : null;
  return { id, type: "roll-template", template: typeof value.template === "string" ? value.template : null, system: typeof value.system === "string" ? value.system : null, title: typeof value.title === "string" ? value.title : null, fields, resultLevel: level, fallbackText: String(value.fallbackText ?? "") };
}

export function validateLogEntryDocument(input: unknown) {
  const warnings: ParserWarning[] = [];
  if (!input || typeof input !== "object") return { ok: false as const, error: "document must be an object", warnings };
  const value = input as Record<string, unknown>;
  if (value.version !== 2 || !KINDS.has(String(value.kind)) || !Array.isArray(value.blocks)) return { ok: false as const, error: "unsupported document schema", warnings };
  const source = value.source && typeof value.source === "object" ? value.source as Record<string, unknown> : {};
  const timestamp = value.timestamp && typeof value.timestamp === "object" ? value.timestamp as Record<string, unknown> : {};
  const speakerValue = value.speaker && typeof value.speaker === "object" ? value.speaker as Record<string, unknown> : null;
  const blocks = value.blocks.map((block, index) => sanitizeBlock(block, warnings, `blocks[${index}]`)).filter((block): block is LogBlock => Boolean(block));
  const document: LogEntryDocument = {
    version: 2, kind: value.kind as LogEntryDocument["kind"],
    source: { platform: source.platform === "manual" ? "manual" : "roll20", messageId: typeof source.messageId === "string" ? source.messageId : null, sourceKey: typeof source.sourceKey === "string" ? source.sourceKey : null, sourceOrder: typeof source.sourceOrder === "number" ? source.sourceOrder : null },
    speaker: speakerValue ? { name: typeof speakerValue.name === "string" ? speakerValue.name.replace(/[:：]\s*$/, "").slice(0, 200) : null, color: typeof speakerValue.color === "string" ? speakerValue.color : null, avatarUrl: safeHttpsUrl(speakerValue.avatarUrl) } : null,
    timestamp: { raw: typeof timestamp.raw === "string" ? timestamp.raw : null, iso: typeof timestamp.iso === "string" && !Number.isNaN(Date.parse(timestamp.iso)) ? new Date(timestamp.iso).toISOString() : null },
    blocks,
    warnings: [...(Array.isArray(value.warnings) ? value.warnings.filter((item): item is ParserWarning => Boolean(item && typeof item === "object" && typeof (item as ParserWarning).code === "string" && typeof (item as ParserWarning).message === "string")) : []), ...warnings]
  };
  if (warnings.some((warning) => warning.code === "invalid-document-node")) return { ok: false as const, error: "document contains an invalid node", warnings };
  const ids = new Set<string>();
  let duplicateId: string | null = null;
  const visitId = (id: string) => { if (ids.has(id)) duplicateId = id; else ids.add(id); };
  const visitRich = (node: RichNode) => {
    visitId(node.id);
    if (node.type === "element") node.children.forEach(visitRich);
    if (node.type === "inline-roll") visitId(node.roll.id);
  };
  document.blocks.forEach((block) => {
    visitId(block.id);
    if (block.type === "rich") block.nodes.forEach(visitRich);
    if (block.type === "roll-template") block.fields.forEach((field) => { visitId(field.id); field.content.forEach((item) => visitId(item.id)); });
  });
  if (duplicateId) return { ok: false as const, error: `document contains duplicate stable id: ${duplicateId}`, warnings };
  return { ok: true as const, document, warnings };
}
