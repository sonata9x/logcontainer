import * as cheerio from "cheerio";
import type { SupportedImportPlatform } from "./types";

export type PlatformDetection = { platform: SupportedImportPlatform | null; scores: Record<SupportedImportPlatform, number>; ambiguous: boolean };

export function detectImportPlatform(source: string): PlatformDetection {
  const $ = cheerio.load(source);
  let roll20 = 0;
  let takoyaki = 0;
  if (/var\s+msgdata\s*=/.test(source)) roll20 += 10;
  if ($(".message").length) roll20 += 3;
  if ($(".message[data-messageid]").length) roll20 += 3;
  if ($(".inlinerollresult, [class*='sheet-rolltemplate-']").length) roll20 += 2;
  if ($(".tkbx-log").length) takoyaki += 4;
  if ($(".tkbx-panes > .log").length) takoyaki += 5;
  if ($(".tkbx-tabs, .tkbx-tab").length) takoyaki += 2;
  if ($(".tkbx-panes > .log > [data-tab]").length) takoyaki += 3;
  if ($(".tkbx-panes > .log > .msg, .tkbx-panes > .log > .msg-script").length) takoyaki += 2;
  const scores = { roll20, "takoyaki-box": takoyaki };
  const best = Math.max(roll20, takoyaki);
  if (best < 5) return { platform: null, scores, ambiguous: false };
  if (roll20 === takoyaki) return { platform: null, scores, ambiguous: true };
  return { platform: roll20 > takoyaki ? "roll20" : "takoyaki-box", scores, ambiguous: false };
}
