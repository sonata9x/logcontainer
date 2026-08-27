import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Roll20V2Renderer } from "../components/logs/Roll20V2Renderer";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const fixture = readFileSync(new URL("./fixtures/roll20/rendered-v2-cases.html", import.meta.url), "utf8");
const topologyFixture = readFileSync(new URL("./fixtures/roll20/rendered-topology-v2.html", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("v2 renderer emits only service-owned Roll20 classes and structured content", () => {
  const result = importRoll20HtmlV2(fixture, { removeDuplicateMessages: true });
  const html = result.documents.map((document) => renderToStaticMarkup(createElement(Roll20V2Renderer, { document }))).join("");
  assert.match(html, /class="r20-message/);
  assert.match(html, /class="r20-inline-roll/);
  assert.match(html, /class="log-rich-context r20-rich-context /);
  assert.doesNotMatch(html, /class="message|class="by|inlinerollresult|sheet-rolltemplate/);
  assert.doesNotMatch(html, /<script|javascript:|position:fixed|position:sticky/i);
});

test("renderer keeps continuation headers hidden and presents CoC labels without internal identifiers", () => {
  const result = importRoll20HtmlV2(topologyFixture);
  const html = result.documents.map((document) => renderToStaticMarkup(createElement(Roll20V2Renderer, { document }))).join("");
  assert.equal((html.match(/>GM:<\/strong>/g) ?? []).length, 3);
  assert.match(html, /관찰력/);
  assert.match(html, /<caption>관찰력<\/caption>/);
  assert.match(html, /class="r20-template__label">기준치:/);
  assert.match(html, /기준치/);
  assert.match(html, /65 \/ 32 \/ 13/);
  assert.match(html, /판정결과/);
  assert.match(html, />실패</);
  assert.doesNotMatch(html, />coc-1</);
  assert.doesNotMatch(html, />failure</);
});

test("Roll20 theme keeps messages frameless, descriptions centered, and dialogue avatar gutters fixed", () => {
  assert.match(themeCss, /\.log-entry-v2 \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0;[\s\S]*?background: #fff;/);
  assert.doesNotMatch(themeCss, /\.entry-wrap:nth-child\(even\) \.r20-message/);
  assert.match(themeCss, /\.r20-message--dialogue \{[\s\S]*?grid-template-columns: 32px minmax\(0, 1fr\)/);
  assert.match(themeCss, /\.r20-message__avatar \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?aspect-ratio: 1 \/ 1;[\s\S]*?border: 0;[\s\S]*?border-radius: 0;/);
  assert.match(themeCss, /\.r20-message--description \.r20-message__content-flow \{ text-align: center; \}/);
  assert.match(themeCss, /\.r20-inline-roll \{[\s\S]*?border: 0;[\s\S]*?border-radius: 0;[\s\S]*?background: #fff9c7;/);
  assert.match(themeCss, /\.r20-template__table caption \{[\s\S]*?background: #000;[\s\S]*?color: #fff;/);
});

test("image alt remains alternative text and is not rendered as a caption", () => {
  const result = importRoll20HtmlV2(topologyFixture);
  const document = result.documents.find((item) => item.source.messageId === "alt-image-1")!;
  const html = renderToStaticMarkup(createElement(Roll20V2Renderer, { document }));
  assert.match(html, /alt="인트로"/);
  assert.doesNotMatch(html, /<figcaption>인트로<\/figcaption>/);
});
