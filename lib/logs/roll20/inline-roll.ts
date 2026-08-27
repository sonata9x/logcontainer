import type { InlineRollBlock, InlineRollState } from "@/lib/logs/model/types";
import { stableRoll20Id } from "./id";

type InlineRollSource = { expression?: unknown; results?: { total?: unknown; rolls?: unknown }; signature?: unknown };

export function inlineRollStateFromClasses(classes: string): InlineRollState {
  if (/fullcrit|critsuccess/i.test(classes)) return "critical";
  if (/fullfail|critfail/i.test(classes)) return "fumble";
  if (/importantroll/i.test(classes)) return "important";
  return "normal";
}

export function inlineRollFromSource(source: unknown, index: number, seed: string, classes = "", displayedValue?: string): InlineRollBlock {
  const roll = source && typeof source === "object" ? source as InlineRollSource : {};
  const total = roll.results?.total;
  const expression = typeof roll.expression === "string" ? roll.expression : null;
  const rawFormula = expression ?? (roll.results?.rolls ? JSON.stringify(roll.results.rolls) : null);
  const value = displayedValue?.trim() || (total == null ? `$[[${index}]]` : String(total));
  return { id: stableRoll20Id("roll", seed, index, value), type: "inline-roll", value, expression, state: inlineRollStateFromClasses(classes), tooltip: expression, rawFormula };
}
