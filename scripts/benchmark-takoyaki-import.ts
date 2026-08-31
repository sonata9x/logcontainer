import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importLogHtml } from "../lib/logs/import/registry";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: tsx scripts/benchmark-takoyaki-import.ts <export.html>");
const source = readFileSync(resolve(sourcePath), "utf8");
const startedAt = performance.now();
const result = importLogHtml(source, "takoyaki-box");
const elapsedMs = performance.now() - startedAt;
const warningCodes = Object.fromEntries(Object.entries(result.documents.flatMap((document) => document.warnings).reduce<Record<string, number>>((counts, warning) => ({ ...counts, [warning.code]: (counts[warning.code] ?? 0) + 1 }), {})).sort());
const avatarUrls = result.documents.flatMap((document) => document.speaker?.avatarUrl ? [document.speaker.avatarUrl] : []);
console.log(JSON.stringify({
  sourceBytes: Buffer.byteLength(source, "utf8"),
  sourceMessageCount: result.report.sourceMessageCount,
  logicalMessageCount: result.report.logicalMessageCount,
  streamCount: result.report.streamCount,
  privateMessageCount: result.documents.filter((document) => document.presentation?.private).length,
  avatarMessageCount: avatarUrls.length,
  distinctAvatarCount: new Set(avatarUrls).size,
  embeddedAvatarMessageCount: avatarUrls.filter((url) => url.startsWith("data:image/")).length,
  scriptDescriptionCount: result.documents.filter((document) => document.source.messageType === "script" && document.kind === "description").length,
  timestampMessageCount: result.documents.filter((document) => document.timestamp.raw).length,
  invalidPrivateLabelTimestampCount: result.documents.filter((document) => /lock|비밀/i.test(document.timestamp.raw ?? "")).length,
  warningCount: result.report.warningCount,
  emptyProjectedMessageCount: result.entries.filter((entry) => !entry.content.trim()).length,
  preservedImageOnlyMessageCount: result.entries.filter((entry) => !entry.content.trim() && entry.has_image_content).length,
  emptyMessageTypes: result.documents.filter((_document, index) => !result.entries[index].content.trim()).map((document) => document.source.messageType),
  warningCodes,
  firstSourceOrder: result.documents[0]?.source.sourceOrder ?? null,
  lastSourceOrder: result.documents.at(-1)?.source.sourceOrder ?? null,
  elapsedMs: Math.round(elapsedMs)
}, null, 2));
