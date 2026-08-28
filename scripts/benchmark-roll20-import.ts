import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const targetMiB = Number(process.argv[2] ?? 20);
if (!Number.isFinite(targetMiB) || targetMiB <= 0 || targetMiB > 100) {
  throw new Error("Benchmark size must be between 0 and 100 MiB");
}

const targetBytes = Math.floor(targetMiB * 1024 * 1024);
const messageCount = Math.max(1, Math.round(targetBytes / 2_048));
const fixedMessage = '<div class="message general" data-messageid="m-000000"><span class="by">GM:</span><span></span></div>';
const payloadSize = Math.max(32, Math.floor((targetBytes - 64 - fixedMessage.length * messageCount) / messageCount));
const payload = "x".repeat(payloadSize);
const messages = Array.from({ length: messageCount }, (_, index) => `<div class="message general" data-messageid="m-${index.toString().padStart(6, "0")}"><span class="by">GM:</span><span>${payload}</span></div>`);
const source = `<!doctype html><html><body>${messages.join("")}</body></html>`;
const sourceBytes = Buffer.byteLength(source, "utf8");

const runtime = globalThis as typeof globalThis & { gc?: () => void };
runtime.gc?.();
const before = process.memoryUsage();
const startedAt = process.hrtime.bigint();
const imported = importRoll20HtmlV2(source);
const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
const after = process.memoryUsage();

const toMiB = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(1));
console.log(JSON.stringify({
  targetMiB,
  sourceBytes,
  sourceMiB: toMiB(sourceBytes),
  messageCount,
  parsedDocuments: imported.documents.length,
  elapsedMs: Number(elapsedMs.toFixed(1)),
  rssBeforeMiB: toMiB(before.rss),
  rssAfterMiB: toMiB(after.rss),
  rssDeltaMiB: toMiB(after.rss - before.rss),
  heapBeforeMiB: toMiB(before.heapUsed),
  heapAfterMiB: toMiB(after.heapUsed),
  heapDeltaMiB: toMiB(after.heapUsed - before.heapUsed)
}));
