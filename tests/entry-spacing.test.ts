import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCompactEntrySpacing } from "../lib/logs/entry-spacing";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";
import { visibleStreamEntries } from "../components/logs/LogStreamTabs";
import type { LogEntry } from "../lib/types";
import type { LogEntryDocument } from "../lib/logs/model/types";

function entry(name: string | null, extra: Partial<LogEntry> = {}): LogEntry {
  return { id: "entry", log_id: "page", order_index: 0, sort_key: 0,
    entry_type: "dialogue", speaker_name: name, speaker_color: null,
    content: "text", raw_html: null, is_deleted: false, deleted_at: null,
    is_added: false, updated_by: null, created_at: "", updated_at: "", ...extra };
}

function v2(name: string, blocks?: LogEntryDocument["blocks"]): LogEntry {
  const document = importRoll20HtmlV2(`<div class="message general"><span class="by">${name}:</span>text</div>`).documents[0];
  return entry(name, { document_version: 2, document: { ...document, kind: "dialogue", speaker: { name, color: null, avatarUrl: null }, ...(blocks ? { blocks } : {}) } });
}

test("only adjacent named dialogue from the same speaker is compact", () => {
  for (const make of [entry, v2]) {
    const a = make("GM"), b = make("PC"), next = make("GM");
    assert.equal(isCompactEntrySpacing(next, a), true);
    assert.equal(isCompactEntrySpacing(next, b), false);
    assert.equal(isCompactEntrySpacing(next, undefined), false);
    assert.equal(isCompactEntrySpacing(next, { ...a, is_deleted: true }), false);
    assert.equal(isCompactEntrySpacing(next, { ...a, document: null, speaker_name: null }), false);
    // Reordering must recompute from current adjacency, not import continuation.
    if (next.document) next.document.presentation = { speakerExplicit: false, avatarExplicit: false, timestampExplicit: false, continuation: true };
    assert.equal(isCompactEntrySpacing(next, b), false);
  }
  assert.equal(isCompactEntrySpacing(entry(null), entry(null)), false);
  assert.equal(isCompactEntrySpacing(entry("GM", { entry_type: "system" }), entry("GM")), false);
});

test("dice cards, CSS panels, images and descriptions retain the full gap on both sides", () => {
  const ordinary = v2("GM");
  const documents = ["rendered-v2-cases.html", "rendered-topology-v2.html"].flatMap((file) => importRoll20HtmlV2(readFileSync(new URL(`./fixtures/roll20/${file}`, import.meta.url), "utf8")).documents);
  for (const type of ["roll-template", "rich", "image"] as const) {
    const block = documents.flatMap((document) => document.blocks).find((block) => block.type === type);
    assert.ok(block, `fixture must include ${type}`);
    const panel = v2("GM", [block]);
    assert.equal(isCompactEntrySpacing(panel, ordinary), false);
    assert.equal(isCompactEntrySpacing(ordinary, panel), false);
  }
  const description = v2("GM");
  description.document!.kind = "description";
  assert.equal(isCompactEntrySpacing(ordinary, description), false);
  assert.equal(isCompactEntrySpacing(description, ordinary), false);
});

test("stream filtering and append boundaries use the visible predecessor", () => {
  const a = v2("GM"), hidden = v2("PC"), b = v2("GM");
  hidden.document!.source.stream = { id: "casual", name: null };
  const visible = visibleStreamEntries([a, hidden, b], "main");
  assert.equal(visible.length, 2);
  assert.equal(isCompactEntrySpacing(visible[1], visible[0]), true);
  assert.equal(isCompactEntrySpacing(v2("GM"), visible.at(-1)), true);
});

test("all three views share spacing; dice edge margins and import continuation padding cannot stack", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.log-timeline > \* \+ \* \{ margin-block-start: 12px; \}/);
  assert.match(css, /\.log-timeline > \[data-compact-spacing="true"\] \{ margin-block-start: 4px; \}/);
  assert.match(css, /\.log-timeline \.log-entry \{ margin-block: 0; \}/);
  assert.match(css, /:is\(\.r20-template, \.r20-image-block\):last-child \{ margin-bottom: 0; \}/);
  assert.doesNotMatch(css, /\.r20-message--continuation \{/);
  for (const view of ["LogEditor", "PublicLog", "GuestLog"]) {
    const source = readFileSync(new URL(`../components/${view}.tsx`, import.meta.url), "utf8");
    assert.match(source, /className="log-timeline"/);
    assert.match(source, /isCompactEntrySpacing\(entry, visibleEntries\[index - 1\]\)/);
    assert.match(source, /data-compact-spacing=/);
  }
});
