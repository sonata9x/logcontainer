import * as cheerio from "cheerio";
import type { InlineRollBlock, RollTemplateBlock, RollTemplateField, TextBlock } from "@/lib/logs/model/types";
import { stableRoll20Id } from "./id";
import { inlineRollFromSource } from "./inline-roll";

type TemplateSource = { content: string; template: string | null; inlinerolls: unknown[]; seed: string };

function fieldPairs(content: string) {
  return [...content.matchAll(/\{\{([^}=]+)=([\s\S]*?)}}/g)].map((match) => ({ key: match[1].trim(), raw: match[2].trim() }));
}

export function parseInlineContent(content: string, inlinerolls: unknown[], seed: string): Array<TextBlock | InlineRollBlock> {
  const blocks: Array<TextBlock | InlineRollBlock> = [];
  let cursor = 0;
  for (const match of content.matchAll(/\$\[\[(\d+)]]/g)) {
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ id: stableRoll20Id("text", seed, cursor, content.slice(cursor, index)), type: "text", text: content.slice(cursor, index) });
    const rollIndex = Number(match[1]);
    blocks.push(inlineRollFromSource(inlinerolls[rollIndex], rollIndex, seed));
    cursor = index + match[0].length;
  }
  if (cursor < content.length) blocks.push({ id: stableRoll20Id("text", seed, cursor, content.slice(cursor)), type: "text", text: content.slice(cursor) });
  if (!blocks.length && content) blocks.push({ id: stableRoll20Id("text", seed, content), type: "text", text: content });
  return blocks;
}

function projectedInline(content: Array<TextBlock | InlineRollBlock>) {
  return content.map((item) => item.type === "text" ? item.text : item.value).join("").trim();
}

export function semanticTemplateKey(key: string) {
  const normalized = key.toLowerCase().replace(/[\s:：_-]+/g, "");
  if (["success", "target", "target1", "기준치"].includes(normalized)) return "target";
  if (["hard", "hard1", "어려운성공"].includes(normalized)) return "hard";
  if (["extreme", "extreme1", "극단적성공"].includes(normalized)) return "extreme";
  if (["roll1", "roll", "rolled", "굴림"].includes(normalized)) return "rolled";
  if (["result", "outcome", "판정결과", "결과"].includes(normalized)) return "result";
  return key;
}

function numeric(value: string | undefined) {
  const parsed = Number(String(value ?? "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resultLevelFromLabel(label: string | null | undefined): RollTemplateBlock["resultLevel"] {
  const normalized = String(label ?? "").toLowerCase().replace(/\s+/g, "");
  if (!normalized) return null;
  if (/대성공|critical/.test(normalized)) return "critical";
  if (/극단적성공|extreme/.test(normalized)) return "extreme";
  if (/어려운성공|hard/.test(normalized)) return "hard";
  if (/대실패|fumble/.test(normalized)) return "fumble";
  if (/실패|failure|fail/.test(normalized)) return "failure";
  if (/성공|success/.test(normalized)) return "success";
  return null;
}

function inferredResultLevel(fields: RollTemplateField[], label?: string | null): RollTemplateBlock["resultLevel"] {
  const labeled = resultLevelFromLabel(label);
  if (labeled) return labeled;
  const values = Object.fromEntries(fields.map((field) => [field.key, field.value]));
  const rolled = numeric(values.rolled);
  const target = numeric(values.target);
  const hard = numeric(values.hard);
  const extreme = numeric(values.extreme);
  if (rolled == null) return null;
  if (rolled === 1) return "critical";
  if (rolled === 100 || (target != null && target < 50 && rolled >= 96)) return "fumble";
  if (extreme != null && rolled <= extreme) return "extreme";
  if (hard != null && rolled <= hard) return "hard";
  if (target != null) return rolled <= target ? "success" : "failure";
  return null;
}

export function localizedResultLabel(level: RollTemplateBlock["resultLevel"]) {
  return level ? ({ critical: "대성공", extreme: "극단적 성공", hard: "어려운 성공", success: "성공", failure: "실패", fumble: "대실패" } as const)[level] : null;
}

function textField(seed: string, index: number, key: string, label: string, value: string): RollTemplateField {
  return {
    id: stableRoll20Id("field", seed, index, key),
    key,
    label,
    value,
    content: value ? [{ id: stableRoll20Id("text", seed, index, key, value), type: "text", text: value }] : []
  };
}

export function parseRenderedRollTemplate(html: string, template: string | null, seed: string): RollTemplateBlock {
  const $ = cheerio.load(html, null, false);
  const root = $("[class*='sheet-rolltemplate-']").first();
  const title = root.find("caption, .sheet-template_title, .sheet-template-title, .sheet-template_name, .sheet-template-name").first().text().replace(/\s+/g, " ").trim() || null;
  const fields: RollTemplateField[] = [];
  root.find("tr").each((rowIndex, row) => {
    const cells = $(row).find("th,td");
    if (!cells.length) return;
    const label = ($(row).find(".sheet-template_label, .sheet-template-label, th").first().text() || cells.first().text()).replace(/\s+/g, " ").replace(/[:：]\s*$/, "").trim();
    const value = ($(row).find(".sheet-template_value, .sheet-template-value").last().text() || cells.last().text()).replace(/\s+/g, " ").trim();
    if (!label || (cells.length === 1 && label === value)) return;
    const key = semanticTemplateKey(label);
    if (key === "target") {
      const thresholds = value.match(/\d+(?:\.\d+)?/g) ?? [];
      fields.push(textField(seed, rowIndex * 4, "target", "기준치", thresholds[0] ?? value));
      if (thresholds[1]) fields.push(textField(seed, rowIndex * 4 + 1, "hard", "어려운 성공", thresholds[1]));
      if (thresholds[2]) fields.push(textField(seed, rowIndex * 4 + 2, "extreme", "극단적 성공", thresholds[2]));
      return;
    }
    fields.push(textField(seed, rowIndex * 4, key, label, value));
  });
  const resultField = fields.find((field) => field.key === "result");
  const resultLabel = resultField?.value || root.find(".sheet-template_result, .sheet-template-result, [class*='result']").last().text().replace(/\s+/g, " ").trim() || null;
  const resultLevel = inferredResultLevel(fields, resultLabel);
  const fallbackText = [title, ...fields.map((field) => `${field.label} ${field.value}`)].filter(Boolean).join(" / ");
  return { id: stableRoll20Id("template", seed, template, fallbackText), type: "roll-template", template, system: template?.includes("coc") ? "coc7" : null, title, fields, resultLevel, resultLabel: resultLabel || localizedResultLabel(resultLevel), fallbackText };
}

export function enrichRollTemplateFromRendered(block: RollTemplateBlock, html: string, seed: string) {
  const rendered = parseRenderedRollTemplate(html, block.template, seed);
  const renderedSemanticCount = rendered.fields.filter((field) => ["target", "hard", "extreme", "rolled", "result"].includes(field.key)).length;
  const fields = renderedSemanticCount >= 2 ? rendered.fields : block.fields;
  const resultLabel = rendered.resultLabel || block.resultLabel || fields.find((field) => field.key === "result")?.value || null;
  const resultLevel = rendered.resultLevel || inferredResultLevel(fields, resultLabel) || block.resultLevel;
  return {
    ...block,
    title: rendered.title || block.title,
    fields,
    resultLevel,
    resultLabel: resultLabel || localizedResultLabel(resultLevel),
    fallbackText: renderedSemanticCount >= 2 ? rendered.fallbackText : block.fallbackText
  } satisfies RollTemplateBlock;
}

export function parseRollTemplate(source: TemplateSource): RollTemplateBlock {
  const pairs = fieldPairs(source.content);
  const fields = pairs.filter((pair) => !["name", "title"].includes(pair.key.toLowerCase())).map((pair, index) => {
    const content = parseInlineContent(pair.raw, source.inlinerolls, `${source.seed}:field:${index}`);
    const key = semanticTemplateKey(pair.key);
    return { id: stableRoll20Id("field", source.seed, index, pair.key), key, label: pair.key, value: projectedInline(content), content };
  });
  const titlePair = pairs.find((pair) => ["name", "title"].includes(pair.key.toLowerCase()));
  const title = titlePair ? projectedInline(parseInlineContent(titlePair.raw, source.inlinerolls, `${source.seed}:title`)) : null;
  const resultLabel = fields.find((field) => field.key === "result")?.value || null;
  const level = inferredResultLevel(fields, resultLabel);
  const fallbackText = [title, ...fields.map((field) => `${field.label} ${field.value}`)].filter(Boolean).join(" / ");
  return { id: stableRoll20Id("template", source.seed, source.template, source.content), type: "roll-template", template: source.template, system: source.template?.includes("coc") ? "coc7" : null, title, fields, resultLevel: level, resultLabel: resultLabel || localizedResultLabel(level), fallbackText };
}
