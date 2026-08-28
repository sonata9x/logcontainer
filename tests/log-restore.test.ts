import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/202608280012_log_restore_original.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/pages/[id]/restore-original/route.ts", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");

test("full restore is owner-only and uses the canonical import baseline", () => {
  assert.match(migration, /can_restore_resource_original\(target_page_id, auth\.uid\(\)\)/);
  assert.match(migration, /exists \(select 1 from public\.log_imports/);
  assert.match(migration, /document = coalesce\(entry\.original_document, entry\.document\)/);
  assert.match(migration, /content = coalesce\(entry\.original_content, entry\.content\)/);
  assert.doesNotMatch(route, /importRoll20|parseRoll20|source_html/);
});

test("restore removes manual entries while preserving resource-level state", () => {
  assert.match(migration, /delete from public\.log_entries where log_id = target_log\.id and is_added = true/);
  assert.match(migration, /is_deleted = false, deleted_at = null/);
  assert.doesNotMatch(migration, /update public\.(pages|resource_shares|page_share_links|publications|workspace_items)/);
});

test("restore archives the current generation and emits one replacement event", () => {
  assert.match(route, /LOG_GENERATION_BUCKET/);
  assert.match(route, /pre-restore\.json\.gz/);
  assert.match(route, /guest_participant_id/);
  assert.match(migration, /insert into public\.log_restore_events/);
  assert.match(migration, /values \(target_log\.id, null, 'log_replaced'\)/);
  assert.match(migration, /set_config\('app\.bulk_log_replace', 'true'/);
});

test("page toolbar uses the central permission DTO and a compact overflow menu", () => {
  assert.match(editor, /permissions\.canManageShares/);
  assert.match(editor, /permissions\.canReimport/);
  assert.match(editor, /permissions\.canRestoreOriginal/);
  assert.match(editor, /permissions\.canTrashResource/);
  assert.match(editor, /LogInfoDialog/);
  assert.doesNotMatch(editor, /className="editor-actions"/);
});
