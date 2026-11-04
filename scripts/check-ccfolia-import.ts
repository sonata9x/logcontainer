import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { listCcfoliaZipTabs, extractCcfoliaZipTab, extractCcfoliaZipTabs } from "../lib/logs/ccfolia/zip";
import { importLogHtml } from "../lib/logs/import/registry";
import { isStoredLogEntryDocumentV2 } from "../lib/logs/model/validate";

const path = process.argv[2];
if (!path) throw new Error("Usage: npx tsx scripts/check-ccfolia-import.ts <export.zip>");
const zip = new Uint8Array(readFileSync(path));
let total = 0;
for (const tab of listCcfoliaZipTabs(zip)) {
  const source = new TextDecoder().decode(extractCcfoliaZipTab(zip, tab.path));
  const $ = cheerio.load(source);
  const nodes = $(".message-list > article.message");
  const start = performance.now();
  const result = importLogHtml(source, "auto");
  total += result.entries.length;
  assert.equal(result.platform, "ccfolia");
  assert.equal(result.entries.length, nodes.length);
  result.documents.forEach((doc, index) => {
    assert.ok(isStoredLogEntryDocumentV2(doc));
    assert.equal(doc.speaker?.name ?? null, nodes.eq(index).find(".speaker").text().trim() || null);
    assert.equal(doc.timestamp.iso, nodes.eq(index).find("time").attr("datetime") ?? null);
  });
  console.log(JSON.stringify({ tab: tab.label, messages: result.entries.length, avatars: result.documents.filter((doc) => doc.speaker?.avatarUrl).length, colors: new Set(result.documents.map((doc) => doc.speaker?.color).filter(Boolean)).size, warnings: result.report.warningCount, parseMs: Math.round(performance.now() - start) }));
}
const tabs = listCcfoliaZipTabs(zip);
const combined = importLogHtml(extractCcfoliaZipTabs(zip, tabs.map((tab) => tab.path)), "ccfolia");
assert.equal(combined.entries.length, total);
assert.equal(new Set(combined.documents.map((doc) => doc.source.stream?.id)).size, tabs.length);
console.log(JSON.stringify({ selectedTabs: tabs.length, combinedMessages: combined.entries.length, warnings: combined.report.warningCount }));
