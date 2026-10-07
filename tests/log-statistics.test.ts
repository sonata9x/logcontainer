import assert from "node:assert/strict";
import test from "node:test";
import { calculateLogStatistics, localWallClockValue, normalizeEntryTimestampDisplay, normalizeRoll20DocumentTimestamps } from "../lib/logs/statistics";
import type { LogEntryDocument } from "../lib/logs/model/types";
import type { LogEntry } from "../lib/types";

function document(raw: string | null, text: string, kind: LogEntryDocument["kind"] = "dialogue"): LogEntryDocument {
  return {
    version: 2,
    kind,
    source: { platform: "roll20", messageId: null, sourceKey: null, sourceOrder: null },
    speaker: kind === "dialogue" ? { name: "GM", color: null, avatarUrl: null } : null,
    timestamp: { raw, iso: null },
    presentation: { speakerExplicit: kind === "dialogue", avatarExplicit: false, timestampExplicit: Boolean(raw), continuation: false },
    blocks: [{ id: `text-${text}`, type: "text", text }],
    warnings: []
  };
}

function entry(id: string, source: LogEntryDocument, sortKey: number): LogEntry {
  return {
    id, log_id: "log", order_index: sortKey, sort_key: sortKey, entry_type: source.kind === "dialogue" ? "dialogue" : "system",
    speaker_name: source.speaker?.name ?? null, speaker_color: null, content: source.blocks[0].type === "text" ? source.blocks[0].text : "", raw_html: null,
    document_version: 2, document: source, is_deleted: false, deleted_at: null, is_added: false, updated_by: null, created_at: "", updated_at: ""
  };
}

test("Roll20 time-only labels inherit the date and cross midnight", () => {
  const normalized = normalizeRoll20DocumentTimestamps([
    document("July 22, 2026 11:30PM", "a"),
    document("11:50PM", "b"),
    document("12:10AM", "c")
  ]);
  assert.deepEqual(normalized.map((item) => item.timestamp.raw), ["July 22, 2026 11:30PM", "July 22, 2026 11:50PM", "July 23, 2026 12:10AM"]);
  assert.equal(normalized[2].timestamp.iso, "2026-07-23T00:10:00.000Z");
});

test("time-only labels before the first dated label resolve backwards", () => {
  const entries = [
    entry("a", document("11:50PM", "a"), 1),
    entry("b", document("July 23, 2026 12:10AM", "b"), 2)
  ];
  assert.deepEqual(normalizeEntryTimestampDisplay(entries).map((item) => item.document?.timestamp.raw), ["July 22, 2026 11:50PM", "July 23, 2026 12:10AM"]);
  assert.equal(entries[0].document?.timestamp.raw, "11:50PM");
});

test("time-only-only logs calculate duration without inventing a display date", () => {
  const entries = [
    entry("a", document("11:30PM", "a"), 1),
    entry("b", document("11:50PM", "b"), 2),
    entry("c", document("12:10AM", "c"), 3)
  ];
  const normalized = normalizeEntryTimestampDisplay(entries);
  const statistics = calculateLogStatistics(entries);

  assert.deepEqual(normalized.map((item) => item.document?.timestamp.raw), ["11:30PM", "11:50PM", "12:10AM"]);
  assert.equal(statistics.timestampCount, 3);
  assert.deepEqual(statistics.oneHour, { minutes: 40, segments: 1 });
  assert.deepEqual(statistics.threeHours, { minutes: 40, segments: 1 });
});

test("time-only Roll20 labels use the latest date within 24 hours of local upload time", () => {
  const uploadWallClock = localWallClockValue("2026-07-22T15:30:00.000Z", -540);
  assert.notEqual(uploadWallClock, null);
  const normalized = normalizeRoll20DocumentTimestamps([
    document("11:50PM", "a"),
    document("12:10AM", "b")
  ], uploadWallClock);

  assert.deepEqual(normalized.map((item) => item.timestamp.raw), ["July 22, 2026 11:50PM", "July 23, 2026 12:10AM"]);
  assert.equal(normalized[1].timestamp.iso, "2026-07-23T00:10:00.000Z");
});

test("upload time wins for the recent time-only tail after a much older dated message", () => {
  const uploadWallClock = localWallClockValue("2026-10-07T06:00:00.000Z", -540);
  const normalized = normalizeRoll20DocumentTimestamps([
    document("July 01, 2026 1:00PM", "old"),
    document("2:30PM", "recent")
  ], uploadWallClock);

  assert.equal(normalized[1].timestamp.raw, "October 07, 2026 2:30PM");
});

test("log statistics count dialogue text and report both one-hour and three-hour break rules", () => {
  const entries = [
    entry("a", document("July 22, 2026 12:00AM", "가 나"), 1),
    entry("b", document("12:30AM", "설명", "description"), 2),
    entry("c", document("2:00AM", "다"), 3),
    entry("d", document("4:00AM", "라마"), 4)
  ];
  const statistics = calculateLogStatistics(entries);
  assert.equal(statistics.dialogueCharacterCount, 6);
  assert.equal(statistics.timestampCount, 4);
  assert.deepEqual(statistics.oneHour, { minutes: 30, segments: 3 });
  assert.deepEqual(statistics.threeHours, { minutes: 240, segments: 1 });
});
