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
  assert.deepEqual(result.documents.map((document) => document.source.sourceOrder), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(result.documents.map((document) => document.source.stream?.id), ["main", "ho2", "main", "ho3", "ho2", "main", "ho2"]);
  assert.deepEqual(result.documents.map((document) => document.source.stream?.name), ["메인", "HO2", "메인", "HO3", "HO2", "메인", "HO2"]);
  assert.equal(result.documents[1].presentation?.private, true);
  assert.match(projectDocumentText(result.documents[3]).replace(/\s+/g, " "), /관찰력.*성공/);
  assert.match(projectDocumentText(result.documents[4]).replace(/\s+/g, " "), /HP.*10 → 12/);
  assert.equal(result.entries[0].sort_key, 1_000_000);
  assert.match(JSON.stringify(result.documents[5].blocks), /data:image\/webp;base64/);
});

test("Takoyaki Box parser does not drop events hidden only by tab CSS", () => {
  const result = importLogHtml(fixture, "takoyaki-box");
  assert.equal(result.documents.length, 7);
  assert.equal(result.report.logicalMessageCount, 7);
});

test("Takoyaki dialogue imports the .txt contents without its block wrapper", () => {
  const result = importLogHtml(fixture, "takoyaki-box");
  assert.equal(result.documents[0].blocks[0].type, "rich");
  assert.doesNotMatch(JSON.stringify(result.documents[0].blocks), /"tag":"div"/);
  assert.equal(projectDocumentText(result.documents[0]), "첫 메시지");
});

test("Takoyaki CoC cards use the same canonical Roll20 template renderer data", () => {
  const result = importLogHtml(fixture, "takoyaki-box");
  const block = result.documents[3].blocks[0];
  assert.equal(block.type, "roll-template");
  if (block.type !== "roll-template") return;
  assert.equal(block.system, "coc7");
  assert.equal(block.title, "관찰력");
  assert.equal(block.resultLevel, "success");
  assert.deepEqual(Object.fromEntries(block.fields.map((field) => [field.key, field.value])), {
    target: "65", hard: "32", extreme: "13", rolled: "42", result: "성공"
  });
});

test("Takoyaki unopposed totals become Roll20 inline rolls", () => {
  const html = '<div class="tkbx-log"><div class="tkbx-panes"><div class="log"><div class="msg" data-id="roll-1"><div class="body"><div class="who"><span>GM</span></div><div class="dcard dcard-tkt" data-level="sum"><div class="tkt-word">68</div><div class="tkt-meta"><b class="tkt-name">1d100</b></div></div></div></div></div></div></div>';
  const result = importLogHtml(html, "takoyaki-box");
  assert.deepEqual(result.documents[0].blocks[0], {
    id: result.documents[0].blocks[0].id,
    type: "inline-roll",
    value: "68",
    expression: "1d100",
    state: "normal",
    tooltip: "1d100",
    rawFormula: "1d100"
  });
});

test("Takoyaki CSS avatars, speaker color, script semantics, and private headers use canonical fields", () => {
  const result = importLogHtml(fixture, "takoyaki-box");
  assert.match(result.documents[0].speaker?.avatarUrl ?? "", /^data:image\/png;base64,/);
  assert.equal(result.documents[0].speaker?.color, "rgb(10, 20, 30)");
  assert.equal(result.documents[0].timestamp.raw, "2026-08-31 12:00");
  assert.equal(result.documents[1].kind, "description");
  assert.equal(result.documents[1].speaker, null);
  assert.equal(result.documents[6].presentation?.private, true);
  assert.equal(result.documents[6].timestamp.raw, null);
  assert.equal(result.documents[6].speaker?.name, "가람");
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
