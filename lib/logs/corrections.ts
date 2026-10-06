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

export const reviewExportSettings: CorrectionSettings = {
  remove_html_tags: true,
  normalize_ellipsis: false,
  normalize_quotes: false,
  speaker_tab_format: false,
  clean_blank_lines: true,
  mark_handout_position: true,
  custom_quote_open: "“",
  custom_quote_close: "”",
  custom_ellipsis: "…",
  custom_handout_icon: "★"
};

export type SpeakerExportMode = "every-message" | "visible-only";
export type ExportRequest = { preset: "review"; speakerMode: SpeakerExportMode } | { preset: "custom"; settings: CorrectionSettings; speakerMode: SpeakerExportMode };

function parseSpeakerExportMode(value: unknown): SpeakerExportMode | null {
  if (value === undefined || value === "every-message") return "every-message";
  return value === "visible-only" ? value : null;
}

export function parseExportRequest(input: unknown): ExportRequest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const speakerMode = parseSpeakerExportMode(value.speakerMode);
  if (!speakerMode) return null;
  if (value.preset === "review") return { preset: "review", speakerMode };
  if (value.preset === "custom") {
    const settings = parseCorrectionSettings(value.settings);
    return settings ? { preset: "custom", settings, speakerMode } : null;
  }
  // Older clients posted the settings object directly. Keep that API compatible.
  const settings = parseCorrectionSettings(input);
  return settings ? { preset: "custom", settings, speakerMode } : null;
}

const correctionBooleanKeys = ["remove_html_tags", "normalize_ellipsis", "normalize_quotes", "speaker_tab_format", "clean_blank_lines", "mark_handout_position"] as const;
const correctionTextKeys = ["custom_quote_open", "custom_quote_close", "custom_ellipsis", "custom_handout_icon"] as const;

export function parseCorrectionSettings(input: unknown): CorrectionSettings | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  for (const key of correctionBooleanKeys) if (typeof record[key] !== "boolean") return null;
  for (const key of correctionTextKeys) if (typeof record[key] !== "string" || record[key].length > 8) return null;
  return Object.fromEntries([...correctionBooleanKeys, ...correctionTextKeys].map((key) => [key, record[key]])) as CorrectionSettings;
}

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

function currentSpeakerName(entry: LogEntry) {
  return entry.document_version === 2 && entry.document
    ? entry.document.speaker?.name?.trim() || null
    : entry.speaker_name?.trim() || null;
}

function exportedSpeakerName(entry: LogEntry, speakerMode: SpeakerExportMode) {
  const speakerName = currentSpeakerName(entry);
  if (!speakerName) return null;
  if (speakerMode === "every-message" || entry.document_version !== 2 || !entry.document) return speakerName;
  return entry.document.kind === "dialogue" && entry.document.presentation?.speakerExplicit === true ? speakerName : null;
}

function entryToText(entry: LogEntry, settings: CorrectionSettings, reviewMarkerFormat: boolean, speakerMode: SpeakerExportMode) {
  const projected = entry.content;
  const v2ImageOnly = entry.document_version === 2 && entry.has_image_content === true;
  let text: string;
  if (settings.mark_handout_position && (v2ImageOnly || ["image", "handout"].includes(entry.entry_type))) {
    if (reviewMarkerFormat) {
      const kind = entry.entry_type === "handout" ? "핸드아웃" : "이미지";
      text = `[${kind} : ${projected.trim() || kind}]`;
    } else {
      text = `${settings.custom_handout_icon || "★"} 이미지/핸드아웃 [${projected.trim() || "이미지/핸드아웃"}]`;
    }
  } else {
    text = projected;
    if (settings.remove_html_tags) text = stripHtml(text);
    if (settings.normalize_ellipsis) text = normalizeEllipsis(text, settings.custom_ellipsis);
    if (settings.normalize_quotes) text = normalizeQuotes(text, settings.custom_quote_open, settings.custom_quote_close);
    text = text.split(/\r\n?|\n/).map((line) => line.replace(/[ \t]+$/g, "")).join("\n").trim();
  }
  const speakerName = exportedSpeakerName(entry, speakerMode);
  if (speakerName) return settings.speaker_tab_format ? `${speakerName}\t${text}` : `${speakerName}: ${text}`;
  return text;
}

export function createReviewExport(entries: LogEntry[], speakerMode: SpeakerExportMode = "every-message") {
  return applyCorrectionsInternal(entries, reviewExportSettings, true, speakerMode);
}

export function applyCorrections(entries: LogEntry[], partial: Partial<CorrectionSettings> = {}, speakerMode: SpeakerExportMode = "every-message") {
  const settings = { ...defaultCorrectionSettings, ...partial };
  return applyCorrectionsInternal(entries, settings, false, speakerMode);
}

function applyCorrectionsInternal(entries: LogEntry[], settings: CorrectionSettings, reviewMarkerFormat: boolean, speakerMode: SpeakerExportMode) {
  let text = [...entries].sort((a, b) => (a.sort_key ?? a.order_index * 1_000_000) - (b.sort_key ?? b.order_index * 1_000_000)).filter((entry) => !entry.is_deleted).map((entry) => entryToText(entry, settings, reviewMarkerFormat, speakerMode)).filter(Boolean).join("\n\n");
  if (settings.clean_blank_lines) text = text.replace(/\n{3,}/g, "\n\n").trim();
  return `${text}\n`;
}
