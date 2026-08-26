import * as cheerio from "cheerio";

type InlineRoll = { results?: { total?: number | string } };
type TemplateField = { key: string; value: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character] ?? character);
}

function inlineRollTotal(inlineRolls: unknown[], index: number) {
  const roll = inlineRolls[index] as InlineRoll | undefined;
  const total = roll?.results?.total;
  return total == null ? null : String(total);
}

export function replaceInlineRolls(content: string, inlineRolls: unknown[] = []) {
  return content.replace(/\$\[\[(\d+)]]/g, (token, indexText: string) => inlineRollTotal(inlineRolls, Number(indexText)) ?? token);
}

function templateFields(content: string) {
  const fields: TemplateField[] = [];
  for (const match of content.matchAll(/\{\{([^}=]+)=([\s\S]*?)}}/g)) {
    fields.push({ key: match[1].trim(), value: match[2].trim() });
  }
  return fields;
}

function templateName(content: string) {
  return content.match(/&\{template:([^}]+)}/i)?.[1]?.trim() ?? null;
}

function readableTemplateText(content: string) {
  const fields = templateFields(content);
  if (!fields.length) return null;
  const values = Object.fromEntries(fields.map((field) => [field.key.toLowerCase(), field.value]));

  if (values.name && values.roll1) {
    const thresholds = [
      values.success ? `성공 ${values.success}` : null,
      values.hard ? `어려움 ${values.hard}` : null,
      values.extreme ? `극단 ${values.extreme}` : null
    ].filter(Boolean);
    return `${values.name}: ${values.roll1}${thresholds.length ? ` (${thresholds.join(" / ")})` : ""}`;
  }

  const title = values.name || values.title;
  const rest = fields.filter((field) => !["name", "title"].includes(field.key.toLowerCase())).map((field) => `${field.key} ${field.value}`).join(" / ");
  return title ? `${title}${rest ? `: ${rest}` : ""}` : fields.map((field) => `${field.key}: ${field.value}`).join(" / ");
}

function isImageUrl(value: string) {
  try {
    const url = new URL(value);
    return /\.(?:png|jpe?g|gif|webp|avif)(?:$|\?)/i.test(url.pathname + url.search) || url.hostname.includes("d20.io") || url.hostname.includes("postimg");
  } catch {
    return false;
  }
}

function renderText(content: string) {
  let html = escapeHtml(content);
  html = html.replace(/\[([^\]]+)]\((https?:\/\/[^)\s]+)\)/g, (_token, label: string, href: string) => {
    if (isImageUrl(href)) {
      return `<figure class="roll20-inline-image"><img src="${escapeHtml(href)}" alt="${escapeHtml(label)}" loading="lazy"><figcaption>${escapeHtml(label)}</figcaption></figure>`;
    }
    return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
  });
  return html.replace(/\n/g, "<br>");
}

function renderTemplate(content: string) {
  const fields = templateFields(content);
  if (!fields.length) return null;
  const titleIndex = fields.findIndex((field) => ["name", "title"].includes(field.key.toLowerCase()));
  const title = titleIndex >= 0 ? fields[titleIndex] : null;
  const rows = fields.filter((_field, index) => index !== titleIndex);
  return `<div class="roll20-template"><div class="roll20-template-kind">${escapeHtml(templateName(content) ?? "roll")}</div>${title ? `<div class="roll20-template-title">${renderText(title.value)}</div>` : ""}${rows.length ? `<dl class="roll20-template-fields">${rows.map((field) => `<div class="roll20-template-row"><dt>${escapeHtml(field.key)}</dt><dd>${renderText(field.value)}</dd></div>`).join("")}</dl>` : ""}</div>`;
}

export function roll20ContentToHtml(content: string, inlineRolls: unknown[] = []) {
  const replaced = replaceInlineRolls(content, inlineRolls);
  if (/<\/?[a-z][\s\S]*>/i.test(replaced)) return replaced;
  return renderTemplate(replaced) ?? renderText(replaced);
}

export function roll20ContentToText(content: string, inlineRolls: unknown[] = []) {
  const replaced = replaceInlineRolls(content, inlineRolls);
  const template = readableTemplateText(replaced);
  if (template) return template;
  if (/<\/?[a-z][\s\S]*>/i.test(replaced)) return cheerio.load(replaced).text().replace(/\s+/g, " ").trim();
  return replaced.replace(/\[([^\]]+)]\([^)]*\)/g, "$1").replace(/^\s*\/desc\s*/i, "").replace(/\s+/g, " ").trim();
}

export function objectContentToString(value: unknown): string {
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

export function containsMarkdownImage(content: string) {
  return /\[[^\]]*]\(https?:\/\/[^)\s]+\.(?:png|jpe?g|gif|webp|avif)(?:\?[^)]*)?\)/i.test(content);
}
