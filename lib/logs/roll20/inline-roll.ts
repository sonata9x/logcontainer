import type { InlineRollBlock, InlineRollState } from "@/lib/logs/model/types";
import { stableRoll20Id } from "./id";

type InlineRollSource = { expression?: unknown; results?: { total?: unknown; rolls?: unknown }; signature?: unknown };

export function inlineRollStateFromClasses(classes: string): InlineRollState {
  if (/fullcrit|critsuccess/i.test(classes)) return "critical";
  if (/fullfail|critfail/i.test(classes)) return "fumble";
  if (/importantroll/i.test(classes)) return "important";
  return "normal";
}

function expressionFromTooltip(tooltip: string | undefined) {
  if (!tooltip) return null;
  const rolling = tooltip.match(/^\s*Rolling\s+([\s\S]+?)\s*=\s*/i)?.[1]?.trim();
  return rolling?.replace(/^\[\[|]]$/g, "").trim() || null;
}

export function inlineRollFromSource(source: unknown, index: number, seed: string, classes = "", displayedValue?: string, renderedTooltip?: string): InlineRollBlock {
  const roll = source && typeof source === "object" ? source as InlineRollSource : {};
  const total = roll.results?.total;
  const expression = typeof roll.expression === "string" ? roll.expression : expressionFromTooltip(renderedTooltip);
  const rawFormula = expression ?? (roll.results?.rolls ? JSON.stringify(roll.results.rolls) : null);
  const value = displayedValue?.trim() || (total == null ? `$[[${index}]]` : String(total));
  return { id: stableRoll20Id("roll", seed, index, value), type: "inline-roll", value, expression, state: inlineRollStateFromClasses(classes), tooltip: renderedTooltip?.trim() || expression, rawFormula };
}
