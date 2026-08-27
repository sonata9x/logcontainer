import postcss from "postcss";
import valueParser, { type Node as ValueNode } from "postcss-value-parser";
import type { RichStyle, RichStyleDeclaration } from "@/lib/logs/model/types";

const ALLOWED_PROPERTIES = new Set([
  "color", "font-size", "font-weight", "font-style", "font-family", "line-height", "letter-spacing",
  "text-align", "text-decoration", "text-shadow", "white-space", "background", "background-color",
  "background-image", "width", "height", "min-width", "max-width", "min-height", "max-height",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "margin", "margin-top",
  "margin-right", "margin-bottom", "margin-left", "border", "border-width", "border-style", "border-color",
  "border-radius", "border-top", "border-right", "border-bottom", "border-left", "display", "vertical-align",
  "position", "top", "right", "bottom", "left"
]);

const NEGATIVE_ALLOWED = new Set([
  "top", "right", "bottom", "left", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "letter-spacing"
]);
const NON_NEGATIVE_LENGTH = new Set([
  "width", "height", "min-width", "max-width", "min-height", "max-height", "padding", "padding-top",
  "padding-right", "padding-bottom", "padding-left", "border-width", "border-radius"
]);
const LENGTH_PROPERTIES = new Set([...NEGATIVE_ALLOWED, ...NON_NEGATIVE_LENGTH, "font-size"]);
const SAFE_FUNCTIONS = new Set(["rgb", "rgba", "hsl", "hsla", "calc", "min", "max", "clamp"]);
const SAFE_DISPLAY = new Set(["block", "inline", "inline-block", "flex", "inline-flex", "grid", "table", "table-row", "table-cell", "none"]);
const SAFE_POSITION = new Set(["static", "relative", "absolute"]);
const MAX_DECLARATIONS = 64;

export type RichStyleSanitizeResult = {
  style: RichStyle;
  sanitizedCount: number;
  droppedCount: number;
  warnings: string[];
};

function decodeCssEscapes(value: string) {
  return value.replace(/\\([0-9a-f]{1,6})(?:\s)?/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\(.)/g, "$1");
}

function parsedUrl(node: ValueNode) {
  const raw = valueParser.stringify("nodes" in node ? node.nodes : []).trim().replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
  return decodeCssEscapes(raw).trim();
}

function hasUnsafeValue(value: string) {
  const decoded = decodeCssEscapes(value).replace(/[\u0000-\u001f\u007f]/g, "").toLowerCase();
  return decoded.includes("expression(") || decoded.includes("@import") || decoded.includes("javascript:") || decoded.includes("data:") || decoded.includes("file:") || decoded.includes("blob:") || decoded.includes("-moz-binding");
}

function safeValueFunctions(value: string, allowImages: boolean) {
  let safe = true;
  valueParser(value).walk((node) => {
    if (!safe || node.type !== "function") return false;
    const name = decodeCssEscapes(node.value).toLowerCase();
    if (name === "url") {
      if (!allowImages) { safe = false; return false; }
      try {
        const url = new URL(parsedUrl(node));
        if (url.protocol !== "https:") safe = false;
      } catch { safe = false; }
      return false;
    }
    if (allowImages && ["linear-gradient", "radial-gradient", "repeating-linear-gradient", "repeating-radial-gradient"].includes(name)) return;
    if (!SAFE_FUNCTIONS.has(name)) safe = false;
  });
  return safe;
}

function numericValuesAreSafe(property: string, value: string) {
  if (!LENGTH_PROPERTIES.has(property)) return true;
  const values = [...value.matchAll(/(-?\d*\.?\d+)\s*([a-z]+|%)?/gi)];
  for (const match of values) {
    const amount = Number(match[1]);
    const unit = (match[2] ?? "").toLowerCase();
    if (!Number.isFinite(amount)) return false;
    if (!unit && amount !== 0) return false;
    if (unit && !["px", "pt", "em", "rem", "%"].includes(unit)) return false;
    if (amount < 0 && !NEGATIVE_ALLOWED.has(property)) return false;
    if (NON_NEGATIVE_LENGTH.has(property) && amount < 0) return false;
    const absolute = Math.abs(amount);
    const limit = unit === "%" ? 500 : unit === "em" || unit === "rem" ? 200 : 2000;
    if (absolute > limit) return false;
  }
  return true;
}

function validateDeclaration(property: string, value: string) {
  if (!ALLOWED_PROPERTIES.has(property) || !value || value.length > 1000 || hasUnsafeValue(value)) return false;
  if (!numericValuesAreSafe(property, value)) return false;
  if (property === "position") return SAFE_POSITION.has(value.toLowerCase());
  if (property === "display") return SAFE_DISPLAY.has(value.toLowerCase());
  if (property === "background" || property === "background-image") return safeValueFunctions(value, true);
  return safeValueFunctions(value, false);
}

export function sanitizeRichStyle(styleText: string): RichStyleSanitizeResult {
  const style: RichStyle = [];
  const warnings: string[] = [];
  let sanitizedCount = 0;
  let droppedCount = 0;
  if (!styleText.trim()) return { style, sanitizedCount, droppedCount, warnings };

  try {
    const root = postcss.parse(`rich-node{${styleText}}`, { from: undefined });
    const rule = root.first;
    if (!rule || rule.type !== "rule") throw new Error("style rule was not parsed");
    if (root.nodes.length !== 1) { droppedCount += root.nodes.length - 1; warnings.push("extra-css-rules-dropped"); }
    for (const child of rule.nodes ?? []) {
      if (style.length >= MAX_DECLARATIONS) { droppedCount += 1; warnings.push("too-many-declarations"); continue; }
      if (child.type !== "decl") { droppedCount += 1; warnings.push(`unsupported-css-node:${child.type}`); continue; }
      const property = child.prop.trim().toLowerCase();
      const value = child.value.trim();
      if (child.important || !validateDeclaration(property, value)) {
        droppedCount += 1;
        warnings.push(`dropped-style:${property || "unknown"}`);
        continue;
      }
      style.push({ property, value });
      sanitizedCount += 1;
    }
  } catch {
    droppedCount += 1;
    warnings.push("invalid-css");
  }
  return { style, sanitizedCount, droppedCount, warnings };
}

export function sanitizeRichStyleDeclarations(input: unknown): RichStyleSanitizeResult {
  if (!Array.isArray(input)) return { style: [], sanitizedCount: 0, droppedCount: input == null ? 0 : 1, warnings: input == null ? [] : ["invalid-style-document"] };
  const text = input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const declaration = item as Partial<RichStyleDeclaration>;
    return typeof declaration.property === "string" && typeof declaration.value === "string" ? [`${declaration.property}:${declaration.value}`] : [];
  }).join(";");
  return sanitizeRichStyle(text);
}

function reactProperty(property: string) {
  return property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

export function richStyleToReactStyle(style: RichStyle) {
  const result: Record<string, string> = {};
  for (const declaration of style) {
    const property = reactProperty(declaration.property);
    if (property in result) delete result[property];
    result[property] = declaration.value;
  }
  return result;
}
