import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipArchive, gzipArchive } from "../lib/logs/archive";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

const migration = readFileSync(new URL("../supabase/migrations/202608270004_log_performance.sql", import.meta.url), "utf8");
const latencyMigration = readFileSync(new URL("../supabase/migrations/202608280001_response_latency.sql", import.meta.url), "utf8");
const runtimeMigration = readFileSync(new URL("../supabase/migrations/202608280002_runtime_latency.sql", import.meta.url), "utf8");
const settingsMigration = readFileSync(new URL("../supabase/migrations/202608280003_workspace_settings.sql", import.meta.url), "utf8");
const bulkMoveMigration = readFileSync(new URL("../supabase/migrations/202608280004_bulk_resource_move.sql", import.meta.url), "utf8");
const importRoute = readFileSync(new URL("../app/api/pages/[id]/import/route.ts", import.meta.url), "utf8");
const entryRoute = readFileSync(new URL("../app/api/pages/[id]/entries/[entryId]/route.ts", import.meta.url), "utf8");
const logPage = readFileSync(new URL("../app/workspace/pages/[id]/page.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
const serverAuth = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
const apiAuth = readFileSync(new URL("../lib/api-auth.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const normalizedSql = (value: string) => value.replace(/\r\n/g, "\n").trim();

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

test("initial log read is a single 50-row aggregate RPC without original snapshots", () => {
  assert.match(logPage, /get_workspace_log_page/);
  assert.match(logPage, /batch_size: 50/);
  assert.doesNotMatch(logPage, /select\("\*"\)|original_document/);
  assert.match(migration, /sort_key > after_sort_key/);
  assert.match(migration, /limit bounded_size/);
  assert.match(latencyMigration, /'entries', result_entries/);
  assert.match(latencyMigration, /'publication', publication/);
});

test("workspace latency path avoids duplicate tree loads and per-row permission helpers", () => {
  const workspaceHome = readFileSync(new URL("../app/workspace/page.tsx", import.meta.url), "utf8");
  const optimizedTree = latencyMigration.slice(latencyMigration.indexOf("create or replace function public.get_workspace_tree"));
  assert.doesNotMatch(workspaceHome, /get_workspace_tree/);
  assert.doesNotMatch(optimizedTree, /public\.can_view_resource\(p\.id|public\.can_invite_resource\(p\.id/);
  assert.match(latencyMigration, /folder_items_child_folder_idx/);
  assert.match(latencyMigration, /create or replace function public\.get_workspace_log_page/);
  assert.match(latencyMigration, /create or replace function public\.get_personal_session_context/);
  assert.match(serverAuth, /get_personal_session_context/);
  assert.doesNotMatch(serverAuth, /from\("workspaces"\)/);
  assert.match(apiAuth, /get_resource_api_context/);
  assert.match(runtimeMigration, /root_mounts/);
  assert.match(runtimeMigration, /get_log_entry_edit_source/);
  assert.doesNotMatch(runtimeMigration, /distinct on/);
  assert.match(serverAuth, /auth\.getClaims\(\)/);
  assert.match(apiAuth, /auth\.getClaims\(\)/);
  assert.match(editor, /hasStyledContent/);
  assert.match(editor, /useState<LogEntryDocument \| null>\(null\)/);
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
  const nextMarker = "-- 202608280001_response_latency.sql";
  const runtimeMarker = "-- 202608280002_runtime_latency.sql";
  const settingsMarker = "-- 202608280003_workspace_settings.sql";
  const bulkMoveMarker = "-- 202608280004_bulk_resource_move.sql";
  assert.equal(normalizedSql(schema.slice(schema.indexOf(marker) + marker.length, schema.indexOf(nextMarker))), normalizedSql(migration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(nextMarker) + nextMarker.length, schema.indexOf(runtimeMarker))), normalizedSql(latencyMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(runtimeMarker) + runtimeMarker.length, schema.indexOf(settingsMarker))), normalizedSql(runtimeMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(settingsMarker) + settingsMarker.length, schema.indexOf(bulkMoveMarker))), normalizedSql(settingsMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(bulkMoveMarker) + bulkMoveMarker.length)), normalizedSql(bulkMoveMigration));
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
