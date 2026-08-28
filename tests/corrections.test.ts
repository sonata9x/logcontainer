import assert from "node:assert/strict";
import test from "node:test";
import { applyCorrections, normalizeEllipsis, normalizeQuotes, stripHtml } from "../lib/logs/corrections";
import type { LogEntry } from "../lib/types";

function entry(overrides: Partial<LogEntry>): LogEntry {
  return { id: crypto.randomUUID(), log_id: "log", order_index: 0, sort_key: 0, entry_type: "dialogue", speaker_name: null, speaker_color: null, content: "", original_content: "", raw_html: null, metadata: {}, is_deleted: false, deleted_at: null, is_added: false, updated_by: null, created_at: "", updated_at: "", ...overrides };
}

test("correction helpers normalize markup, ellipsis, and quotes", () => {
  assert.equal(stripHtml("<b>안녕</b>"), "안녕");
  assert.equal(normalizeEllipsis("음... 아니......"), "음… 아니……");
  assert.equal(normalizeQuotes('"대사"'), "“대사”");
});

test("TXT export sorts entries and formats separate speaker names with tabs", () => {
  const result = applyCorrections([
    entry({ order_index: 1, sort_key: 1, content: '"응..."' }),
    entry({ order_index: 0, sort_key: 0, speaker_name: "민수", content: "<b>안녕</b>" }),
    entry({ order_index: 2, sort_key: 2, entry_type: "image", content: "지도" }),
    entry({ order_index: 3, sort_key: 3, content: "삭제됨", is_deleted: true })
  ]);
  assert.equal(result, "민수\t안녕\n\n“응…”\n\n★ 이미지/핸드아웃 [지도]\n");
});

test("TXT export applies custom markers only at download time", () => {
  const source = entry({ speaker_name: "GM", content: '"기다려..."' });
  const result = applyCorrections([source], { custom_quote_open: "『", custom_quote_close: "』", custom_ellipsis: "⋯" });
  assert.equal(result, "GM\t『기다려⋯』\n");
  assert.equal(source.content, '"기다려..."');
});
