import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";
import { parseRichHtml } from "../lib/logs/roll20/rich";
import { Roll20V2Renderer } from "../components/logs/Roll20V2Renderer";
import type { RichBlock } from "../lib/logs/model/types";

const padding = "\t".repeat(9);
const menu = '<div id="menu-example" class="flyout"></div>';
const examples = [
  '<a style="text-decoration:none;text-align:center;font-weight:bold;color:#b9062f">Example emphasis.</a>',
  '<a style="color:#4e67e6;text-align:center;font-size:18px">✦</a> <a style="display:inline-block;text-align:center;padding:2px 0;width:240px;background-image:linear-gradient(135deg,#4e67e6,#69a2d9)">Please roll.</a>'
];

test("copied Roll20 CSS messages drop flyout UI and its trailing tab padding without changing content styles", () => {
  for (const content of examples) {
    const result = importRoll20HtmlV2(`<div class="message desc" data-messageid="example"><div class="spacer"></div> ${content}${padding}${menu}</div>`);
    assert.equal(result.documents.length, 1);
    const document = result.documents[0];
    assert.doesNotMatch(JSON.stringify(document.blocks), /\\t|flyout/);
    const html = renderToStaticMarkup(createElement(Roll20V2Renderer, { document }));
    assert.doesNotMatch(html, /\t|<div><\/div>|r20-rich-context--block/);
    assert.match(html, /r20-rich-context--inline/);
    assert.match(html, /text-align:center/);
  }
});

test("flyout menu labels never become canonical text, including direct Rich parsing", () => {
  const html = '<a style="color:red">real content</a><div class="flyout"><span>delete menu item</span></div>';
  assert.doesNotMatch(JSON.stringify(parseRichHtml(html, "test").nodes), /delete menu item/);
  const document = importRoll20HtmlV2(`<div class="message desc">${html}</div>`).documents[0];
  assert.doesNotMatch(JSON.stringify(document.blocks), /delete menu item/);
});

test("author breaks, internal preformatted tabs and styled empty layout elements survive", () => {
  const source = `<div class="message desc"><div style="display:block;text-align:center"><br>first<br><br>second<br><div style="height:20px"></div><pre>one\ttwo\nthree</pre></div>${padding}${menu}</div>`;
  const document = importRoll20HtmlV2(source).documents[0];
  const html = renderToStaticMarkup(createElement(Roll20V2Renderer, { document }));
  assert.match(html, /<br\/>first<br\/><br\/>second<br\/>/);
  assert.match(html, /style="height:20px"/);
  assert.match(html, /<pre>one\ttwo\nthree<\/pre>/);
  const withoutMenu = importRoll20HtmlV2(`<div class="message desc"><a style="color:red">text</a>${padding}</div>`).documents[0];
  assert.match(JSON.stringify(withoutMenu.blocks), /\\t/);
});

test("legacy stored Rich documents render without blank flyout shells while immutable data stays unchanged", () => {
  for (const content of examples) {
    const document = importRoll20HtmlV2(`<div class="message desc">${content}</div>`).documents[0];
    const block = document.blocks.find((block): block is RichBlock => block.type === "rich")!;
    block.nodes.push({ id: "old-export-tabs", type: "text", text: padding }, { id: "old-flyout", type: "element", tag: "div", href: null, title: null, style: [], children: [] });
    const original = JSON.stringify(document);
    const html = renderToStaticMarkup(createElement(Roll20V2Renderer, { document }));
    assert.doesNotMatch(html, /\t|<div><\/div>|r20-rich-context--block/);
    assert.equal(JSON.stringify(document), original);
  }
});
