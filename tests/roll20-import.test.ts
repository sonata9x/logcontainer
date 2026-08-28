import assert from "node:assert/strict";
import test from "node:test";
import { importRoll20Html } from "../lib/logs/import";

test("rendered Roll20 HTML removes only repeated data-messageid values", () => {
  const source = `
    <div class="message general" data-messageid="m-1"><span class="by">A:</span><span>Hello</span></div>
    <div class="message general" data-messageid="m-1"><span class="by">A:</span><span>Duplicate copy</span></div>
    <div class="message general" data-messageid="m-2"><span class="by">A:</span><span>Hello</span></div>
    <div class="message general"><span class="by">A:</span><span>Hello</span></div>
    <div class="message general"><span class="by">A:</span><span>Hello</span></div>
  `;

  const result = importRoll20Html(source, { removeDuplicateMessages: true });
  assert.equal(result.entries.length, 4);
  assert.equal(result.report.sourceMessageCount, 5);
  assert.equal(result.report.duplicateMessageCount, 1);
  assert.deepEqual(result.report.duplicateMessageIds, ["m-1"]);
  assert.equal(result.entries[0].content, "Hello");
  assert.equal(result.entries[1].metadata?.roll20MessageId, "m-2");
});

test("rendered Roll20 HTML removes hidden-message before deduplication", () => {
  const source = `
    <div class="message hidden-message" data-messageid="hidden-1">Secret</div>
    <div class="message general" data-messageid="visible-1">Visible</div>
    <div class="message general" data-messageid="visible-1">Repeated</div>
  `;
  const result = importRoll20Html(source, { removeHiddenMessages: true, removeDuplicateMessages: true });
  assert.equal(result.entries.length, 1);
  assert.equal(result.report.hiddenMessageCount, 1);
  assert.equal(result.report.duplicateMessageCount, 1);
});

test("msgdata uses messageId or object key and keeps the first item by priority", () => {
  const payload = [
    { first: { ".priority": 20, messageId: "same-id", type: "general", who: "A", content: "later duplicate" } },
    { second: { ".priority": 10, messageId: "same-id", type: "general", who: "A", content: "first copy" } },
    { hidden: { ".priority": 15, type: "hidden", who: "GM", content: "secret" } },
    { unique: { ".priority": 30, type: "general", who: "B", content: "unique" } }
  ];
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const result = importRoll20Html(`<script>var msgdata = "${encoded}";</script>`, { removeHiddenMessages: true, removeDuplicateMessages: true });

  assert.equal(result.report.sourceFormat, "msgdata");
  assert.equal(result.report.hiddenMessageCount, 1);
  assert.equal(result.report.duplicateMessageCount, 1);
  assert.deepEqual(result.entries.map((entry) => entry.content), ["first copy", "unique"]);
});

test("non-Roll20 HTML is rejected", () => {
  assert.throws(() => importRoll20Html("<main><p>ordinary document</p></main>"), /Roll20 message elements/);
});

test("cleanup is opt-in and preserves hidden or repeated IDs by default", () => {
  const source = `
    <div class="message hidden-message" data-messageid="m-hidden">Secret</div>
    <div class="message general" data-messageid="m-1">First</div>
    <div class="message general" data-messageid="m-1">Second copy</div>
  `;
  const result = importRoll20Html(source);
  assert.equal(result.entries.length, 3);
  assert.equal(result.report.hiddenMessageCount, 0);
  assert.equal(result.report.duplicateMessageCount, 0);
});

test("msgdata replaces inline roll tokens with totals", () => {
  const payload = [{ roll: { ".priority": 1, type: "general", who: "민수", content: "듣기 $[[0]] / $[[1]]", inlinerolls: [{ results: { total: 57 } }, { results: { total: 65 } }] } }];
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const result = importRoll20Html(`<script>var msgdata = "${encoded}";</script>`);
  assert.equal(result.entries[0].content, "듣기 57 / 65");
});

test("msgdata formats Roll20 sheet templates into readable content", () => {
  const payload = [{ roll: { ".priority": 1, type: "general", who: "민수", content: "&{template:coc-1} {{name=듣기}} {{success=$[[0]]}} {{hard=$[[1]]}} {{extreme=$[[2]]}} {{roll1=$[[3]]}}", inlinerolls: [{ results: { total: 65 } }, { results: { total: 32 } }, { results: { total: 13 } }, { results: { total: 57 } }] } }];
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const result = importRoll20Html(`<script>var msgdata = "${encoded}";</script>`);
  assert.equal(result.entries[0].content, "듣기: 57 (성공 65 / 어려움 32 / 극단 13)");
  assert.match(result.entries[0].raw_html ?? "", /roll20-template/);
});

test("msgdata reads object-shaped htmlcontent", () => {
  const payload = [{ desc: { ".priority": 1, type: "desc", who: "", htmlcontent: { html: "<a>도입</a>" } } }];
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const result = importRoll20Html(`<script>var msgdata = "${encoded}";</script>`);
  assert.equal(result.entries[0].content, "도입");
  assert.match(result.entries[0].raw_html ?? "", /<a>도입<\/a>/);
});

test("rendered Roll20 HTML removes avatar and hidden child elements", () => {
  const source = `<div class="message general" data-messageid="g1"><div class="avatar" aria-hidden="true"><img src="avatar.png"></div><span class="by">GM:</span><span>보이는 말</span><span hidden>비밀</span></div>`;
  const result = importRoll20Html(source);
  assert.equal(result.entries[0].content, "보이는 말");
  assert.doesNotMatch(result.entries[0].raw_html ?? "", /avatar|비밀/);
});

test("msgdata renders markdown image links as safe image blocks", () => {
  const payload = [{ image: { ".priority": 1, type: "desc", who: "", content: "[지도](https://example.com/map.png)" } }];
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  const result = importRoll20Html(`<script>var msgdata = "${encoded}";</script>`);
  assert.equal(result.entries[0].entry_type, "image");
  assert.equal(result.entries[0].content, "지도");
  assert.match(result.entries[0].raw_html ?? "", /roll20-inline-image/);
});
