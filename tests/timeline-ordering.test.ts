import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/pages/[id]/entries/reorder/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/202608310002_log_entry_reordering.sql", import.meta.url), "utf8");

test("message drag starts only from a dedicated handle and saves one batch", () => {
  assert.match(editor, /className="log-entry-drag-handle"/);
  assert.match(editor, />⋮⋮<\/button>/);
  assert.doesNotMatch(editor, /<article[^>]+draggable/);
  assert.match(editor, /orderedIds: optimistic\.map/);
  assert.match(editor, /expected: before\.map/);
  assert.match(editor, /\/entries\/reorder/);
});

test("timeline reorder is atomic optimistic-concurrency checked and leaves sourceOrder untouched", () => {
  assert.match(route, /reorder_log_entries_v1/);
  assert.match(route, /error\?\.code === "40001"/);
  assert.match(migration, /public\.can_edit_resource\(target_page_id, auth\.uid\(\)\)/);
  assert.match(migration, /entry\.sort_key = expected\.sort_key/);
  assert.match(migration, /set_config\('app\.bulk_log_replace', 'true'/);
  assert.match(migration, /update public\.logs set content_version = content_version \+ 1/);
  assert.match(migration, /'log_replaced'/);
  assert.doesNotMatch(migration, /set\s+document\s*=/);
});
