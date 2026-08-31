import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importLogHtml } from "../lib/logs/import/registry";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: tsx scripts/benchmark-takoyaki-import.ts <export.html>");
const source = readFileSync(resolve(sourcePath), "utf8");
const startedAt = performance.now();
const result = importLogHtml(source, "takoyaki-box");
const elapsedMs = performance.now() - startedAt;
console.log(JSON.stringify({
  sourceBytes: Buffer.byteLength(source, "utf8"),
  sourceMessageCount: result.report.sourceMessageCount,
  logicalMessageCount: result.report.logicalMessageCount,
  streamCount: result.report.streamCount,
  privateMessageCount: result.documents.filter((document) => document.presentation?.private).length,
  firstSourceOrder: result.documents[0]?.source.sourceOrder ?? null,
  lastSourceOrder: result.documents.at(-1)?.source.sourceOrder ?? null,
  elapsedMs: Math.round(elapsedMs)
}, null, 2));
