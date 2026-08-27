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

function semanticKey(key: string) {
  const normalized = key.toLowerCase();
  if (["success", "target", "target1"].includes(normalized)) return "target";
  if (["hard", "hard1"].includes(normalized)) return "hard";
  if (["extreme", "extreme1"].includes(normalized)) return "extreme";
  if (["roll1", "roll", "rolled"].includes(normalized)) return "rolled";
  if (["result", "outcome"].includes(normalized)) return "result";
  return key;
}

function numeric(value: string | undefined) {
  const parsed = Number(String(value ?? "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function resultLevel(fields: RollTemplateField[]): RollTemplateBlock["resultLevel"] {
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

export function parseRollTemplate(source: TemplateSource): RollTemplateBlock {
  const pairs = fieldPairs(source.content);
  const fields = pairs.filter((pair) => !["name", "title"].includes(pair.key.toLowerCase())).map((pair, index) => {
    const content = parseInlineContent(pair.raw, source.inlinerolls, `${source.seed}:field:${index}`);
    const key = semanticKey(pair.key);
    return { id: stableRoll20Id("field", source.seed, index, pair.key), key, label: pair.key, value: projectedInline(content), content };
  });
  const titlePair = pairs.find((pair) => ["name", "title"].includes(pair.key.toLowerCase()));
  const title = titlePair ? projectedInline(parseInlineContent(titlePair.raw, source.inlinerolls, `${source.seed}:title`)) : null;
  const fallbackText = [title, ...fields.map((field) => `${field.label} ${field.value}`)].filter(Boolean).join(" / ");
  return { id: stableRoll20Id("template", source.seed, source.template, source.content), type: "roll-template", template: source.template, system: source.template?.startsWith("coc") || source.template?.includes("coc") ? "coc7" : null, title, fields, resultLevel: resultLevel(fields), fallbackText };
}
