import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: tsx scripts/check-roll20-import.ts <export.html>");
const source = readFileSync(resolve(sourcePath), "utf8");
const result = importRoll20HtmlV2(source);
console.log(JSON.stringify({
  sourceMessageCount: result.report.sourceMessageCount,
  logicalMessageCount: result.report.logicalMessageCount,
  casualRemovedCount: result.report.hiddenRemovedCount,
  firstSourceOrder: result.documents[0]?.source.sourceOrder ?? null,
  lastSourceOrder: result.documents.at(-1)?.source.sourceOrder ?? null,
  streams: [...new Set(result.documents.map((document) => document.source.stream?.id ?? "none"))]
}, null, 2));
