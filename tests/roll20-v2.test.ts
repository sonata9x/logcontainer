import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectDocumentText } from "../lib/logs/model/projection";
import { validateLogEntryDocument } from "../lib/logs/model/validate";
import { sanitizeRichStyle } from "../lib/logs/rich/style";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const realFixture = readFileSync(new URL("./fixtures/roll20/real-msgdata-anonymized.html", import.meta.url), "utf8");
const renderedFixture = readFileSync(new URL("./fixtures/roll20/rendered-v2-cases.html", import.meta.url), "utf8");
const topologyFixture = readFileSync(new URL("./fixtures/roll20/rendered-topology-v2.html", import.meta.url), "utf8");
const enrichmentFixture = readFileSync(new URL("./fixtures/roll20/msgdata-rendered-enrichment.html", import.meta.url), "utf8");

test("actual-derived msgdata fixture matches the v2 canonical golden projection", () => {
  const result = importRoll20HtmlV2(realFixture);
  assert.equal(result.report.sourceFormat, "msgdata");
  assert.equal(result.report.sourceMessageCount, 5);
  assert.equal(result.report.logicalMessageCount, 5);
  assert.deepEqual(result.documents.map((document) => document.kind), ["dialogue", "description", "dialogue", "dialogue", "dialogue"]);
  assert.deepEqual(result.documents[2].blocks.map((block) => block.type), ["text", "inline-roll", "text"]);
  assert.equal(projectDocumentText(result.documents[2]), "피해 45 적용");
  const templates = result.documents.flatMap((document) => document.blocks).filter((block) => block.type === "roll-template");
  assert.deepEqual(templates.map((template) => template.template), ["coc-1", "type-coc-attack-1"]);
  assert.deepEqual(templates.map((template) => template.resultLevel), ["success", "failure"]);
});

test("rendered adapter normalizes structural lanes and preserves inline roll order", () => {
  const result = importRoll20HtmlV2(renderedFixture);
  assert.equal(result.report.structuralDuplicateCount, 1);
  const message = result.documents.find((document) => document.source.messageId === "struct-1");
  assert.ok(message);
  assert.equal(message.speaker?.name, "진희령");
  assert.deepEqual(message.blocks.slice(0, 3).map((block) => block.type), ["text", "inline-roll", "text"]);
  assert.match(projectDocumentText(message), /체력 3 차감합니다/);
  const rich = result.documents.find((document) => document.source.messageId === "rich-1")?.blocks.find((block) => block.type === "rich");
  assert.ok(rich && rich.type === "rich");
  const serialized = JSON.stringify(rich.nodes);
  for (const expected of ["color", "background-color", "font-size", "position", "top", "letter-spacing", "background-image"]) assert.match(serialized, new RegExp(expected));
  assert.equal(result.report.unknownFallbackCount, 1);
});

test("actual sibling topology normalizes nearby same-id DOM without requiring different lanes", () => {
  const result = importRoll20HtmlV2(topologyFixture);
  assert.equal(result.report.sourceMessageCount, 8);
  assert.equal(result.report.logicalMessageCount, 7);
  assert.equal(result.report.structuralDuplicateCount, 1);
  const sibling = result.documents.find((document) => document.source.messageId === "sibling-1");
  assert.equal(sibling?.speaker?.name, "GM");
  assert.equal(projectDocumentText(sibling!), "첫 문장");
});

test("rendered continuation messages inherit semantic speaker but keep header presentation state", () => {
  const result = importRoll20HtmlV2(topologyFixture);
  const messages = ["continuation-1", "continuation-2", "continuation-3"].map((id) => result.documents.find((document) => document.source.messageId === id)!);
  assert.deepEqual(messages.map((document) => document.speaker?.name), ["GM", "GM", "GM"]);
  assert.deepEqual(messages.map((document) => document.presentation?.speakerExplicit), [true, false, false]);
  assert.deepEqual(messages.map((document) => document.presentation?.continuation), [false, true, true]);
  const roll = messages[1].blocks.find((block) => block.type === "inline-roll");
  assert.ok(roll && roll.type === "inline-roll");
  assert.equal(roll.expression, "3d6*5");
  assert.match(roll.tooltip ?? "", /^Rolling 3d6\*5/);
});

test("adjacent styled fragments remain one RichBlock flow", () => {
  const result = importRoll20HtmlV2(topologyFixture);
  const document = result.documents.find((item) => item.source.messageId === "rich-flow-1")!;
  const rich = document.blocks.filter((block) => block.type === "rich");
  assert.equal(rich.length, 1);
  assert.ok(rich[0].nodes.length >= 7);
  assert.equal(projectDocumentText(document).replace(/\s+/g, " "), "KPC 주예담 PC 진희령");
});

test("rendered CoC table recovers semantic thresholds, roll, and localized result", () => {
  const result = importRoll20HtmlV2(topologyFixture);
  const template = result.documents.find((document) => document.source.messageId === "coc-rendered-1")?.blocks.find((block) => block.type === "roll-template");
  assert.ok(template && template.type === "roll-template");
  assert.equal(template.title, "관찰력");
  assert.deepEqual(Object.fromEntries(template.fields.map((field) => [field.key, field.value])), { target: "65", hard: "32", extreme: "13", rolled: "88", result: "실패" });
  assert.equal(template.resultLabel, "실패");
  assert.equal(template.resultLevel, "failure");
});

test("msgdata semantic rolls are enriched with rendered presentation metadata", () => {
  const result = importRoll20HtmlV2(enrichmentFixture);
  assert.equal(result.report.sourceFormat, "msgdata");
  assert.equal(result.documents.length, 1);
  const document = result.documents[0];
  assert.equal(document.speaker?.avatarUrl, "https://example.com/player.png");
  assert.equal(document.speaker?.color, "#4b6b9d");
  assert.equal(document.presentation?.avatarExplicit, true);
  assert.equal(document.timestamp.raw, "July 07, 2026 12:06AM");
  const roll = document.blocks.find((block) => block.type === "inline-roll");
  assert.ok(roll && roll.type === "inline-roll");
  assert.equal(roll.expression, "2d6");
  assert.equal(roll.value, "7");
});

test("image error duplicate filter is conservative and option-controlled", () => {
  const off = importRoll20HtmlV2(renderedFixture, { removeDuplicateMessages: false });
  const on = importRoll20HtmlV2(renderedFixture, { removeDuplicateMessages: true });
  assert.equal(off.report.errorDuplicateCount, 0);
  assert.equal(on.report.errorDuplicateCount, 1);
  assert.equal(off.documents.length - on.documents.length, 1);
});

test("Rich CSS keeps ordered declarations and supported real-world values", () => {
  const result = sanitizeRichStyle("padding:10px;padding-top:0;color:#fff;font-size:7pt;width:7.1%;top:-5px;letter-spacing:-1px;background:radial-gradient(circle,#fff,#000);background-image:linear-gradient(90deg,#111,#333),url(https://example.com/a.png);position:absolute");
  assert.deepEqual(result.style.slice(0, 2), [{ property: "padding", value: "10px" }, { property: "padding-top", value: "0" }]);
  for (const property of ["font-size", "width", "top", "letter-spacing", "background", "background-image", "position"]) assert.ok(result.style.some((item) => item.property === property));
  assert.equal(result.droppedCount, 0);
});

test("Rich CSS blocks executable schemes, escaped schemes, page escape, and extreme values", () => {
  const result = sanitizeRichStyle("background-image:url(javascript:alert(1));background:url(\\6a avascript:alert(1));background-image:url(data:image/png;base64,x);position:fixed;position:sticky;top:99999px;left:100vh;width:10;z-index:9999;color:#123");
  assert.deepEqual(result.style, [{ property: "color", value: "#123" }]);
  assert.ok(result.droppedCount >= 8);
});

test("document validation sanitizes snapshots without changing stable IDs", () => {
  const source = importRoll20HtmlV2(realFixture).documents[0];
  const roundTrip = validateLogEntryDocument(JSON.parse(JSON.stringify(source)));
  assert.ok(roundTrip.ok);
  assert.equal(roundTrip.document.blocks[0].id, source.blocks[0].id);
  assert.equal(projectDocumentText(roundTrip.document), projectDocumentText(source));
});
