import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { zipSync, strToU8 } from "fflate";
import { importLogHtml } from "../lib/logs/import/registry";
import { listCcfoliaZipTabs, extractCcfoliaZipTab } from "../lib/logs/ccfolia/zip";
import { isStoredLogEntryDocumentV2, validateLogEntryDocument } from "../lib/logs/model/validate";
import { applyEditableTextChanges, editableTextSegments } from "../lib/logs/model/user-edit";
import { calculateAppendedImport } from "../lib/logs/import/append";
import { Roll20V2Renderer } from "../components/logs/Roll20V2Renderer";
import { renderExternalEntries } from "../lib/external-export/server";
import { EXTERNAL_VIEWER_CSS } from "../lib/external-export/viewer";
import type { LogEntry } from "../lib/types";

const message = (text: string, time = "2026-10-06T15:58:59.975Z") => `<article class="message" data-channel="main"><span class="avatar avatar-image-0"></span><div class="message-content"><div class="message-header"><span class="speaker" style="--speaker-color:#b7d7cb">별</span><time class="timestamp" datetime="${time}">2026. 10. 07. 오전 12:58:59</time><span class="channel-name">[메인]</span></div><div class="message-text">${text}</div><span class="roll-result success">1D100 → 24 성공</span></div></article>`;
const html = (messages: string) => `<style>:root {background:#121212;color:#eee}.avatar-image-0 { background-image: url("data:image/png;base64,aGVsbG8="); }</style><main class="message-list">${messages}</main>`;

test("ZIP directory preserves Korean tab names and extracts only the chosen HTML", () => {
  const zip = zipSync({ "세션[すべて].html": strToU8(html(message("전체"))), "세션[메인].html": strToU8(html(message("선택 본문"))), "세션[비밀].html": strToU8("SECRET"), "readme.txt": strToU8("ignore") });
  const tabs = listCcfoliaZipTabs(zip);
  assert.deepEqual(tabs.map((tab) => tab.label), ["すべて", "메인", "비밀"]);
  const source = new TextDecoder().decode(extractCcfoliaZipTab(zip, tabs[1].path));
  assert.match(source, /선택 본문/); assert.doesNotMatch(source, /SECRET|전체/);
  assert.throws(() => extractCcfoliaZipTab(zip, "missing.html"));
  assert.throws(() => listCcfoliaZipTabs(strToU8("bad ZIP")));
  assert.throws(() => listCcfoliaZipTabs(zipSync({ "x.txt": strToU8("x") })));
});

test("ZIP rejects oversized chosen members before inflating and rejects non-UTF8 HTML", () => {
  const zip = zipSync({ "large.html": new Uint8Array(12 * 1024 * 1024 + 1) });
  assert.equal(listCcfoliaZipTabs(zip).length, 1);
  assert.throws(() => extractCcfoliaZipTab(zip, "large.html"), /12MB/);
  assert.throws(() => extractCcfoliaZipTab(zipSync({ "invalid.html": new Uint8Array([255]) }), "invalid.html"));
});

test("CCFOLIA retains names, colors, avatar, exact time, rich text and dice in canonical documents", () => {
  const result = importLogHtml(html(message('첫 줄\n<strong>두 번째</strong><script>alert(1)</script>')), "auto");
  const doc = result.documents[0];
  assert.equal(result.platform, "ccfolia");
  assert.equal(doc.speaker?.name, "별"); assert.equal(doc.speaker?.color, "#b7d7cb");
  assert.match(doc.speaker?.avatarUrl ?? "", /^data:image\/png/);
  assert.equal(doc.timestamp.iso, "2026-10-06T15:58:59.975Z");
  assert.equal(validateLogEntryDocument(doc).ok, true); assert.ok(isStoredLogEntryDocumentV2(doc));
  assert.match(result.entries[0].content, /첫 줄\n두 번째/);
  assert.match(result.entries[0].content, /1D100 → 24 성공/);
  assert.doesNotMatch(JSON.stringify(doc.blocks), /alert\(1\)/);
  assert.match(JSON.stringify(doc.blocks), /#2196f3/);
  const view = renderToStaticMarkup(createElement(Roll20V2Renderer, { document: doc }));
  assert.match(view, /ccfolia-message/); assert.match(view, /style="color:#b7d7cb"/);
});

test("canonical editing and append preserve CCFOLIA originals and external export uses the dark theme", () => {
  const result = importLogHtml(html(message("원문")), "ccfolia");
  const original = result.documents[0];
  const segment = editableTextSegments(original)[0];
  const edited = applyEditableTextChanges(original, [{ id: segment.id, text: "수정" }]);
  assert.equal(editableTextSegments(original)[0].text, "원문");
  assert.equal(editableTextSegments(edited)[0].text, "수정");
  assert.equal(edited.source.platform, "ccfolia");
  const incoming = importLogHtml(html(message("원문") + message("추가", "2026-10-06T16:00:00Z")), "ccfolia");
  const plan = calculateAppendedImport([{ id: "old", is_added: false, document: edited, original_document: original }], incoming.entries);
  assert.equal(plan.appendedEntries.length, 1);
  const exported = renderExternalEntries([{ ...result.entries[0], id: "test", is_deleted: false } as unknown as LogEntry], null)[0].html;
  assert.match(exported, /ccfolia-message/); assert.match(exported, /color:#b7d7cb/);
  assert.match(EXTERNAL_VIEWER_CSS, /\.ccfolia-message \{ background: #121212/);
  assert.match(EXTERNAL_VIEWER_CSS, /\.ccfolia-message \.log-rich-context \{ color: inherit/);
});
