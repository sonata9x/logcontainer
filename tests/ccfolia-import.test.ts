import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { zipSync, strToU8 } from "fflate";
import { importLogHtml } from "../lib/logs/import/registry";
import { listCcfoliaZipTabs, extractCcfoliaZipTab, extractCcfoliaZipTabs } from "../lib/logs/ccfolia/zip";
import { serializeCcfoliaTabs } from "../lib/logs/ccfolia/bundle";
import { logStreamOptions, parseLogStreams } from "../lib/logs/streams";
import { LogStreamTabs, visibleStreamEntries } from "../components/logs/LogStreamTabs";
import { isStoredLogEntryDocumentV2, validateLogEntryDocument } from "../lib/logs/model/validate";
import { applyEditableTextChanges, editableTextSegments } from "../lib/logs/model/user-edit";
import { calculateAppendedImport } from "../lib/logs/import/append";
import { Roll20V2Renderer } from "../components/logs/Roll20V2Renderer";
import { renderExternalEntries } from "../lib/external-export/server";
import { buildExternalIndexHtml, EXTERNAL_VIEWER_CSS } from "../lib/external-export/viewer";
import type { ExternalLogExportManifest } from "../lib/external-export/types";
import * as cheerio from "cheerio";
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

const selectedSource = (main = message("메인 본문"), info = message("정보 본문")) => serializeCcfoliaTabs([
  { path: "세션[메인].html", name: "메인", html: html(main) },
  { path: "세션[정보].html", name: "정보", html: html(info) }
]);
const asEntries = (source: string) => importLogHtml(source, "ccfolia").entries.map((entry, index) => ({ ...entry, id: `entry-${index}`, is_deleted: false } as unknown as LogEntry));

test("multiple ZIP selections preserve archive order and exclude unselected private HTML", () => {
  const zip = zipSync({ "세션[메인].html": strToU8(html(message("메인 본문"))), "세션[정보].html": strToU8(html(message("정보 본문"))), "세션[비밀].html": strToU8("PRIVATE NOT SELECTED") });
  const source = extractCcfoliaZipTabs(zip, ["세션[정보].html", "세션[메인].html"]);
  assert.doesNotMatch(source, /PRIVATE NOT SELECTED/);
  const result = importLogHtml(source, "auto");
  assert.equal(result.platform, "ccfolia");
  assert.deepEqual(parseLogStreams(result.report.streams).map((stream) => stream.name), ["메인", "정보"]);
  assert.equal(new Set(result.documents.map((doc) => doc.source.messageId)).size, 2);
  assert.deepEqual(result.documents.map((doc) => doc.source.sourceOrder), [0, 0]);
  assert.throws(() => extractCcfoliaZipTabs(zip, []));
  assert.throws(() => extractCcfoliaZipTabs(zip, ["missing.html"]));
  assert.throws(() => extractCcfoliaZipTabs(zip, ["세션[메인].html", "세션[메인].html"]));
});

test("tab views show only the active CCFOLIA HTML and retain unloaded tabs from the catalog", () => {
  const source = selectedSource();
  const entries = asEntries(source);
  const streams = importLogHtml(source, "ccfolia").report.streams;
  const options = logStreamOptions(entries, streams);
  assert.deepEqual(options.map((stream) => stream.name), ["메인", "정보"]);
  assert.deepEqual(visibleStreamEntries(entries, "main", streams).map((entry) => entry.id), ["entry-0"]);
  assert.deepEqual(visibleStreamEntries(entries, options[1].id, streams).map((entry) => entry.id), ["entry-1"]);
  assert.equal(logStreamOptions(entries.slice(0, 1), streams).length, 2);
  assert.deepEqual(visibleStreamEntries(entries.slice(0, 1), options[1].id, streams), []);
  const tabs = renderToStaticMarkup(createElement(LogStreamTabs, { entries: entries.slice(0, 1), streams, active: options[1].id, onChange: () => {} }));
  assert.match(tabs, /aria-pressed="true">정보/);
});

test("Roll20 main/casual and existing single-HTML CCFOLIA imports retain their display behavior", () => {
  const result = importLogHtml('<div class="message" data-messageid="a" data-tab-id="main"><span class="by">GM:</span>main</div><div class="message" data-messageid="b" data-tab-id="casual"><span class="by">GM:</span>casual</div>', "roll20", { separateCasual: true });
  const entries = result.entries as unknown as LogEntry[];
  assert.deepEqual(logStreamOptions(entries).map((stream) => stream.id), ["main", "casual"]);
  assert.equal(visibleStreamEntries(entries, "main").length, 1);
  assert.equal(visibleStreamEntries(entries, "casual").length, 1);
  const old = asEntries(html(message("기존 단일 HTML")));
  assert.equal(logStreamOptions(old).length, 1);
  assert.equal(visibleStreamEntries(old, "main").length, 1);
});

test("CCFOLIA append compares each tab independently when earlier tabs grow", () => {
  const initial = importLogHtml(selectedSource(), "ccfolia");
  const updated = importLogHtml(selectedSource(message("메인 본문") + message("메인 추가", "2026-10-06T16:00:00Z"), message("정보 본문") + message("정보 추가", "2026-10-06T17:00:00Z")), "ccfolia");
  const existing = initial.documents.map((doc, i) => ({ id: `old-${i}`, is_added: false, document: doc, original_document: doc }));
  const plan = calculateAppendedImport(existing, updated.entries);
  assert.equal(plan.appendedEntries.length, 2);
  assert.match(plan.appendedEntries[0].content, /메인 추가/);
  assert.match(plan.appendedEntries[1].content, /정보 추가/);
  assert.throws(() => calculateAppendedImport(existing, importLogHtml(serializeCcfoliaTabs([{ path: "세션[메인].html", name: "메인", html: html(message("메인 본문")) }]), "ccfolia").entries), /같은 HTML 탭/);
  const restored = importLogHtml(selectedSource(), "ccfolia");
  assert.deepEqual(restored.documents, initial.documents);
});

test("manual blocks in a CCFOLIA tab remain in that tab and use the dark renderer", () => {
  const entries = asEntries(selectedSource());
  const added = structuredClone(entries[1]);
  added.id = "added";
  added.document!.source.platform = "manual";
  added.document!.speaker!.color = null;
  assert.deepEqual(visibleStreamEntries([...entries, added], entries[1].document!.source.stream!.id).map((entry) => entry.id), ["entry-1", "added"]);
  const view = renderToStaticMarkup(createElement(Roll20V2Renderer, { document: added.document! }));
  assert.match(view, /ccfolia-message/);
  assert.match(view, /color:#eee/);
});

test("external HTML keeps separate tab names, hides inactive content and escapes tab labels", () => {
  const entries = asEntries(selectedSource());
  const exported = renderExternalEntries(entries, null);
  exported[1].streamName = '정보 <script>alert(1)</script>';
  const manifest = { format: "logcontainer-static-log", version: 1, exportedAt: "2026-11-04T00:00:00Z", page: { title: "테스트", platform: "ccfolia", fontFamily: "pretendard", overview: null }, entries: exported, tracks: [], bgm: [], handouts: [] } as ExternalLogExportManifest;
  const $ = cheerio.load(buildExternalIndexHtml(manifest));
  assert.equal($("[data-stream-tab]").length, 2);
  assert.equal($(".entry-wrap[hidden]").length, 1);
  assert.equal($(".entry-wrap:not([hidden])").attr("data-stream"), entries[0].document!.source.stream!.id);
  assert.equal($("nav script").length, 0);
  assert.match($("nav").text(), /정보 <script>alert\(1\)<\/script>/);
});
