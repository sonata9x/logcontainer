import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectImportPlatform } from "../lib/logs/import/detect";
import { ImportPlatformError } from "../lib/logs/import/types";
import { importLogHtml } from "../lib/logs/import/registry";
import { projectDocumentText } from "../lib/logs/model/projection";

const fixture = readFileSync(new URL("./fixtures/takoyaki-box/exported-log.html", import.meta.url), "utf8");

test("Takoyaki Box export is detected from multiple structural signals", () => {
  const detection = detectImportPlatform(fixture);
  assert.equal(detection.platform, "takoyaki-box");
  assert.ok(detection.scores["takoyaki-box"] >= 10);
});

test("Takoyaki Box direct children remain one global DOM-ordered timeline", () => {
  const result = importLogHtml(fixture, "auto");
  assert.equal(result.platform, "takoyaki-box");
  assert.deepEqual(result.documents.map((document) => document.source.sourceOrder), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(result.documents.map((document) => document.source.stream?.id), ["main", "ho2", "main", "ho3", "ho2", "main"]);
  assert.deepEqual(result.documents.map((document) => document.source.stream?.name), ["메인", "HO2", "메인", "HO3", "HO2", "메인"]);
  assert.equal(result.documents[1].presentation?.private, true);
  assert.match(projectDocumentText(result.documents[3]).replace(/\s+/g, " "), /성공.*관찰력/);
  assert.match(projectDocumentText(result.documents[4]).replace(/\s+/g, " "), /HP.*10 → 12/);
  assert.equal(result.entries[0].sort_key, 1_000_000);
  assert.match(JSON.stringify(result.documents[5].blocks), /data:image\/webp;base64/);
});

test("Takoyaki Box parser does not drop events hidden only by tab CSS", () => {
  const result = importLogHtml(fixture, "takoyaki-box");
  assert.equal(result.documents.length, 6);
  assert.equal(result.report.logicalMessageCount, 6);
});

test("embedded raster data images are preserved while SVG data images are rejected", () => {
  const accepted = importLogHtml(fixture, "takoyaki-box");
  assert.match(JSON.stringify(accepted.documents[5].blocks), /data:image\/webp;base64/);
  const rejected = importLogHtml(fixture.replace("data:image/webp;base64,UklGRg==", "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="), "takoyaki-box");
  assert.doesNotMatch(JSON.stringify(rejected.documents[5].blocks), /data:image\/svg/);
});

test("CCFOLIA selection reports unsupported instead of guessing another parser", () => {
  assert.throws(() => importLogHtml(fixture, "ccfolia"), (error) => error instanceof ImportPlatformError && error.code === "unsupported");
});

test("auto detection rejects unknown HTML", () => {
  assert.throws(() => importLogHtml("<html><p>plain</p></html>", "auto"), (error) => error instanceof ImportPlatformError && error.code === "undetected");
});

test("Roll20 casual stream is always removed by data-tab-id only", () => {
  const html = '<div class="message general" data-messageid="a" data-tab-id="main"><span class="by">GM:</span><span>keep</span></div><div class="message general" data-messageid="b" data-tab-id="casual"><span class="by">GM:</span><span>drop</span></div><div class="message general" data-messageid="c" style="display:none"><span class="by">GM:</span><span>still keep</span></div>';
  const result = importLogHtml(html, "roll20");
  assert.deepEqual(result.documents.map((document) => document.source.messageId), ["a", "c"]);
  assert.equal(result.report.hiddenRemovedCount, 1);
  assert.equal(result.documents[0].source.stream?.name, "메인");
});
