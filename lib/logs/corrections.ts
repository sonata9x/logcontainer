import * as cheerio from "cheerio";
import type { LogEntry } from "@/lib/types";

export type CorrectionSettings = {
  remove_html_tags: boolean;
  normalize_ellipsis: boolean;
  normalize_quotes: boolean;
  speaker_tab_format: boolean;
  clean_blank_lines: boolean;
  mark_handout_position: boolean;
  custom_quote_open: string;
  custom_quote_close: string;
  custom_ellipsis: string;
  custom_handout_icon: string;
};

export const defaultCorrectionSettings: CorrectionSettings = {
  remove_html_tags: true,
  normalize_ellipsis: true,
  normalize_quotes: true,
  speaker_tab_format: true,
  clean_blank_lines: true,
  mark_handout_position: true,
  custom_quote_open: "“",
  custom_quote_close: "”",
  custom_ellipsis: "…",
  custom_handout_icon: "★"
};

export function stripHtml(text: string) {
  return cheerio.load(text).text();
}

export function normalizeEllipsis(text: string, marker = "…") {
  return text.replace(/\.{3,}/g, (match) => marker.repeat(Math.floor(match.length / 3)));
}

export function normalizeQuotes(text: string, open = "“", close = "”") {
  let opening = true;
  return text.replace(/"/g, () => { const value = opening ? open : close; opening = !opening; return value; });
}

function entryToText(entry: LogEntry, settings: CorrectionSettings) {
  if (settings.mark_handout_position && ["image", "handout"].includes(entry.entry_type)) {
    return `${settings.custom_handout_icon || "★"} 이미지/핸드아웃 [${entry.content.trim() || "이미지/핸드아웃"}]`;
  }
  let text = entry.content;
  if (settings.remove_html_tags) text = stripHtml(text);
  if (settings.normalize_ellipsis) text = normalizeEllipsis(text, settings.custom_ellipsis);
  if (settings.normalize_quotes) text = normalizeQuotes(text, settings.custom_quote_open, settings.custom_quote_close);
  text = text.trim();
  if (entry.speaker_name) return settings.speaker_tab_format ? `${entry.speaker_name}\t${text}` : `${entry.speaker_name}: ${text}`;
  return text;
}

export function applyCorrections(entries: LogEntry[], partial: Partial<CorrectionSettings> = {}) {
  const settings = { ...defaultCorrectionSettings, ...partial };
  let text = [...entries].sort((a, b) => a.order_index - b.order_index).filter((entry) => !entry.is_deleted).map((entry) => entryToText(entry, settings)).filter(Boolean).join("\n\n");
  if (settings.clean_blank_lines) text = text.replace(/\n{3,}/g, "\n\n").trim();
  return `${text}\n`;
}
