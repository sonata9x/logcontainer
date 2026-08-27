import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Roll20V2Renderer } from "../components/logs/Roll20V2Renderer";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const fixture = readFileSync(new URL("./fixtures/roll20/rendered-v2-cases.html", import.meta.url), "utf8");

test("v2 renderer emits only service-owned Roll20 classes and structured content", () => {
  const result = importRoll20HtmlV2(fixture, { removeDuplicateMessages: true });
  const html = result.documents.map((document) => renderToStaticMarkup(createElement(Roll20V2Renderer, { document }))).join("");
  assert.match(html, /class="r20-message/);
  assert.match(html, /class="r20-inline-roll/);
  assert.match(html, /class="log-rich-context r20-rich-context"/);
  assert.doesNotMatch(html, /class="message|class="by|inlinerollresult|sheet-rolltemplate/);
  assert.doesNotMatch(html, /<script|javascript:|position:fixed|position:sticky/i);
});
