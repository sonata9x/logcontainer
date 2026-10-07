import { projectDocumentText } from "@/lib/logs/model/projection";
import type { LogEntryDocument } from "@/lib/logs/model/types";
import type { LogEntry } from "@/lib/types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;
const MONTH_INDEX = new Map(MONTHS.map((month, index) => [month.toLocaleLowerCase(), index]));
const DAY_MS = 24 * 60 * 60 * 1_000;

type ParsedTimestamp = { kind: "full"; value: number } | { kind: "time"; hour: number; minute: number };
export type SessionDurationSummary = { minutes: number; segments: number };
export type LogStatistics = {
  dialogueCharacterCount: number;
  timestampCount: number;
  oneHour: SessionDurationSummary;
  threeHours: SessionDurationSummary;
};

function meridiemHour(value: number, period?: string) {
  if (!period) return value;
  if (value < 1 || value > 12) return null;
  const normalized = period.toLocaleUpperCase();
  if (normalized === "AM" || normalized === "오전") return value === 12 ? 0 : value;
  if (normalized === "PM" || normalized === "오후") return value === 12 ? 12 : value + 12;
  return null;
}

function utcValue(year: number, month: number, day: number, hour: number, minute: number) {
  if (![year, month, day, hour, minute].every(Number.isInteger) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const value = Date.UTC(year, month, day, hour, minute);
  const date = new Date(value);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? value : null;
}

function parseTimestamp(raw: string, iso: string | null): ParsedTimestamp | null {
  const text = raw.trim().replace(/\s+/g, " ");
  const englishFull = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (englishFull) {
    const month = MONTH_INDEX.get(englishFull[1].toLocaleLowerCase());
    const hour = meridiemHour(Number(englishFull[4]), englishFull[6]);
    const value = month === undefined || hour === null ? null : utcValue(Number(englishFull[3]), month, Number(englishFull[2]), hour, Number(englishFull[5]));
    return value === null ? null : { kind: "full", value };
  }
  const numericFull = text.match(/^(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})일?\s*(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})$/);
  if (numericFull) {
    const hour = meridiemHour(Number(numericFull[5]), numericFull[4]);
    const value = hour === null ? null : utcValue(Number(numericFull[1]), Number(numericFull[2]) - 1, Number(numericFull[3]), hour, Number(numericFull[6]));
    return value === null ? null : { kind: "full", value };
  }
  const englishTime = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (englishTime) {
    const hour = meridiemHour(Number(englishTime[1]), englishTime[3]);
    return hour === null || Number(englishTime[2]) > 59 ? null : { kind: "time", hour, minute: Number(englishTime[2]) };
  }
  const koreanTime = text.match(/^(오전|오후)\s*(\d{1,2}):(\d{2})$/);
  if (koreanTime) {
    const hour = meridiemHour(Number(koreanTime[2]), koreanTime[1]);
    return hour === null || Number(koreanTime[3]) > 59 ? null : { kind: "time", hour, minute: Number(koreanTime[3]) };
  }
  if (iso) {
    const value = Date.parse(iso);
    if (!Number.isNaN(value)) return { kind: "full", value };
  }
  return null;
}

function sameUtcDateAt(anchor: number, hour: number, minute: number) {
  const date = new Date(anchor);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour, minute);
}

/** Resolves Roll20's time-only labels against the nearest dated labels in source order. */
export function resolveDocumentTimestampValues(documents: LogEntryDocument[], referenceValue: number | null = null) {
  const parsed = documents.map((document) => document.timestamp.raw ? parseTimestamp(document.timestamp.raw, document.timestamp.iso) : null);
  const values: Array<number | null> = parsed.map((value) => value?.kind === "full" ? value.value : null);
  const dateAnchored = parsed.map((value) => value?.kind === "full");
  let anchor: number | null = null;
  for (let index = 0; index < parsed.length; index += 1) {
    const value = parsed[index];
    if (!value) continue;
    if (value.kind === "full") { anchor = value.value; continue; }
    if (anchor === null) continue;
    let candidate = sameUtcDateAt(anchor, value.hour, value.minute);
    while (candidate < anchor) candidate += DAY_MS;
    values[index] = candidate;
    dateAnchored[index] = true;
    anchor = candidate;
  }
  anchor = null;
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const value = parsed[index];
    if (!value) continue;
    if (values[index] !== null) { anchor = values[index]; continue; }
    if (value.kind !== "time" || anchor === null) continue;
    let candidate = sameUtcDateAt(anchor, value.hour, value.minute);
    while (candidate > anchor) candidate -= DAY_MS;
    values[index] = candidate;
    dateAnchored[index] = true;
    anchor = candidate;
  }

  // A Roll20 export created within 24 hours can contain only time labels. Use
  // the import wall clock as the upper bound and choose the latest matching
  // date in the preceding 24 hours, then resolve earlier labels backwards.
  let floatingAnchor = referenceValue !== null && Number.isFinite(referenceValue) ? referenceValue : null;
  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const value = parsed[index];
    if (value?.kind !== "time" || values[index] !== null) continue;
    if (floatingAnchor === null) continue;
    let candidate = sameUtcDateAt(floatingAnchor, value.hour, value.minute);
    while (candidate > floatingAnchor) candidate -= DAY_MS;
    values[index] = candidate;
    dateAnchored[index] = true;
    floatingAnchor = candidate;
  }

  // Statistics can still use source order when old data has neither a dated
  // label nor a recorded import reference. This synthetic date is never shown.
  floatingAnchor = null;
  for (let index = 0; index < parsed.length; index += 1) {
    const value = parsed[index];
    if (value?.kind !== "time" || values[index] !== null) continue;
    let candidate = Date.UTC(2000, 0, 1, value.hour, value.minute);
    if (floatingAnchor !== null) while (candidate < floatingAnchor) candidate += DAY_MS;
    values[index] = candidate;
    floatingAnchor = candidate;
  }
  return { parsed, values, dateAnchored };
}

/** Converts an absolute upload instant to the uploader's local wall clock. */
export function localWallClockValue(instant: string | number | Date, timezoneOffsetMinutes: number) {
  const value = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(value) || !Number.isInteger(timezoneOffsetMinutes) || timezoneOffsetMinutes < -840 || timezoneOffsetMinutes > 840) return null;
  return value - timezoneOffsetMinutes * 60_000;
}

function roll20TimestampLabel(value: number) {
  const date = new Date(value);
  let hour = date.getUTCHours();
  const period = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${MONTHS[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, "0")}, ${date.getUTCFullYear()} ${hour}:${String(date.getUTCMinutes()).padStart(2, "0")}${period}`;
}

export function normalizeRoll20DocumentTimestamps(documents: LogEntryDocument[], referenceValue: number | null = null) {
  const { parsed, values, dateAnchored } = resolveDocumentTimestampValues(documents, referenceValue);
  return documents.map((document, index) => {
    const value = values[index];
    if (document.source.platform !== "roll20" || parsed[index]?.kind !== "time" || value === null || !dateAnchored[index]) return document;
    return { ...document, timestamp: { raw: roll20TimestampLabel(value), iso: new Date(value).toISOString() } };
  });
}

export function normalizeEntryTimestampDisplay(entries: LogEntry[]) {
  const indexed = entries.flatMap((entry, index) => entry.document_version === 2 && entry.document ? [{ entry, index, document: entry.document }] : []);
  const normalized = normalizeRoll20DocumentTimestamps(indexed.map((item) => item.document));
  const replacements = new Map(indexed.map((item, index) => [item.index, normalized[index]]));
  return entries.map((entry, index) => {
    const document = replacements.get(index);
    return document && document !== entry.document ? { ...entry, document } : entry;
  });
}

function sessionDuration(values: number[], gapHours: number): SessionDurationSummary {
  const timestamps = [...new Set(values)].sort((left, right) => left - right);
  if (!timestamps.length) return { minutes: 0, segments: 0 };
  const threshold = gapHours * 60 * 60 * 1_000;
  let start = timestamps[0];
  let end = timestamps[0];
  let total = 0;
  let segments = 1;
  for (const timestamp of timestamps.slice(1)) {
    if (timestamp - end >= threshold) {
      total += end - start;
      start = timestamp;
      segments += 1;
    }
    end = timestamp;
  }
  total += end - start;
  return { minutes: Math.max(0, Math.round(total / 60_000)), segments };
}

export function calculateLogStatistics(entries: LogEntry[], referenceValue: number | null = null): LogStatistics {
  const visible = entries.filter((entry) => !entry.is_deleted);
  const documents = visible.flatMap((entry) => entry.document_version === 2 && entry.document ? [entry.document] : []);
  const resolvedValues = resolveDocumentTimestampValues(documents, referenceValue).values.filter((value): value is number => value !== null);
  const dialogueCharacterCount = visible.reduce((total, entry) => {
    if (entry.document_version === 2 && entry.document) return entry.document.kind === "dialogue" ? total + Array.from(projectDocumentText(entry.document)).length : total;
    return entry.entry_type === "dialogue" ? total + Array.from(entry.content).length : total;
  }, 0);
  return {
    dialogueCharacterCount,
    timestampCount: resolvedValues.length,
    oneHour: sessionDuration(resolvedValues, 1),
    threeHours: sessionDuration(resolvedValues, 3)
  };
}
