import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipArchive, gzipArchive } from "../lib/logs/archive";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const migration = readFileSync(new URL("../supabase/migrations/202608270004_log_performance.sql", import.meta.url), "utf8");
const importRoute = readFileSync(new URL("../app/api/pages/[id]/import/route.ts", import.meta.url), "utf8");
const entryRoute = readFileSync(new URL("../app/api/pages/[id]/entries/[entryId]/route.ts", import.meta.url), "utf8");
const logPage = readFileSync(new URL("../app/workspace/pages/[id]/page.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");

test("raw Roll20 source gzip round-trip is byte-for-byte lossless", () => {
  const source = Buffer.from("<div>한글\r\n&nbsp; 🎲</div>\0", "utf8");
  const archived = gzipArchive(source);
  assert.deepEqual(gunzipArchive(archived.compressed), source);
  assert.equal(archived.sourceSizeBytes, source.byteLength);
  assert.match(archived.sha256, /^[a-f0-9]{64}$/);
});

test("v3 import stores private archive metadata and no duplicate PostgreSQL payload", () => {
  for (const column of ["source_storage_path", "source_sha256", "source_size_bytes", "compressed_size_bytes", "previous_generation_storage_path"]) assert.match(migration, new RegExp(column));
  assert.match(migration, /roll20-source-archives[\s\S]*false/);
  assert.match(migration, /log-generation-archives[\s\S]*false/);
  assert.match(migration, /insert into public\.log_imports[\s\S]*source_html[\s\S]*values[\s\S]*null/);
  assert.match(migration, /parsed_snapshot, replaced_entries_snapshot[\s\S]*null, null/);
  assert.match(migration, /original_document, has_image_content[\s\S]*2, item\.document, null/);
  assert.doesNotMatch(importRoute, /replace_log_entries_v2|source_html:/);
  assert.match(importRoute, /removePrivateArchives\(uploaded\)/);
});

test("copy-on-write and compact revisions preserve restore semantics", () => {
  assert.match(migration, /original_document = coalesce\(original_document, document\)/);
  assert.match(migration, /target_entry\.document, null, 2/);
  assert.match(migration, /target_entry\.content, target_entry\.content, null, null/);
  assert.match(entryRoute, /entry\.original_document \?\? entry\.document/);
  assert.match(entryRoute, /select\("previous_snapshot"\)/);
  assert.match(entryRoute, /id, entry_id, action, editor_id, previous_content, next_content, created_at, revision_schema_version/);
});

test("initial log read is a 200-row cursor DTO without original snapshots", () => {
  assert.match(logPage, /get_log_entries_page/);
  assert.match(logPage, /batch_size: 200/);
  assert.doesNotMatch(logPage, /select\("\*"\)|original_document/);
  assert.match(migration, /sort_key > after_sort_key/);
  assert.match(migration, /limit bounded_size/);
});

test("entry collaboration uses lightweight events and local patches", () => {
  assert.match(migration, /create table if not exists public\.log_change_events/);
  assert.match(migration, /alter publication supabase_realtime drop table public\.log_entries/);
  assert.match(migration, /log_replaced/);
  assert.match(editor, /table: "log_change_events"/);
  assert.match(editor, /\?view=entry/);
  assert.doesNotMatch(editor, /router\.refresh\(/);
});

test("public routes bypass auth refresh and stored documents use lightweight reads", () => {
  assert.match(middleware, /matcher: \["\/workspace\/:path\*", "\/p\/:path\*"\]/);
  const publicBranch = middleware.slice(middleware.indexOf('startsWith("/p/")'));
  assert.doesNotMatch(publicBranch, /auth\.getUser/);
  assert.match(logPage, /toLogEntryDto/);
  assert.match(schema, /202608270004_log_performance\.sql/);
  const marker = "-- 202608270004_log_performance.sql";
  assert.equal(schema.slice(schema.indexOf(marker) + marker.length).trim(), migration.trim());
});

test("large Roll20 fixtures keep 1,000 and 3,000 messages in source order", () => {
  for (const count of [1_000, 3_000]) {
    const source = Array.from({ length: count }, (_, index) => `<div class="message general" data-messageid="m-${index}"><span class="by">GM:</span><span>message ${index}</span></div>`).join("");
    const result = importRoll20HtmlV2(source);
    assert.equal(result.documents.length, count);
    assert.equal(result.documents[0].source.sourceOrder, 0);
    assert.equal(result.documents.at(-1)?.source.sourceOrder, count - 1);
  }
});
