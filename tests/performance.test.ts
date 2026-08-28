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
const securityMigration = readFileSync(new URL("../supabase/migrations/202608280005_security_hardening.sql", import.meta.url), "utf8");
const securityFixMigration = readFileSync(new URL("../supabase/migrations/202608280006_fix_security_rate_limit_timestamp.sql", import.meta.url), "utf8");
const largeImportMigration = readFileSync(new URL("../supabase/migrations/202608280007_roll20_large_import_uploads.sql", import.meta.url), "utf8");
const stagingPolicyMigration = readFileSync(new URL("../supabase/migrations/202608280008_roll20_staging_upload_policy.sql", import.meta.url), "utf8");
const resourceRolesMigration = readFileSync(new URL("../supabase/migrations/202608280009_resource_roles.sql", import.meta.url), "utf8");
const registeredSharingMigration = readFileSync(new URL("../supabase/migrations/202608280010_registered_resource_sharing.sql", import.meta.url), "utf8");
const guestSharingMigration = readFileSync(new URL("../supabase/migrations/202608280011_guest_page_sharing.sql", import.meta.url), "utf8");
const restoreMigration = readFileSync(new URL("../supabase/migrations/202608280012_log_restore_original.sql", import.meta.url), "utf8");
const publicationPrivacyMigration = readFileSync(new URL("../supabase/migrations/202608280013_publication_privacy.sql", import.meta.url), "utf8");
const preferencesMigration = readFileSync(new URL("../supabase/migrations/202608280014_user_preferences.sql", import.meta.url), "utf8");
const importRoute = readFileSync(new URL("../app/api/pages/[id]/import/route.ts", import.meta.url), "utf8");
const uploadRoute = readFileSync(new URL("../app/api/pages/[id]/import/upload/route.ts", import.meta.url), "utf8");
const uploadHelper = readFileSync(new URL("../lib/logs/import-upload.ts", import.meta.url), "utf8");
const importLimits = readFileSync(new URL("../lib/logs/import-limits.ts", import.meta.url), "utf8");
const purgeRoute = readFileSync(new URL("../app/api/internal/purge/route.ts", import.meta.url), "utf8");
const importsRoute = readFileSync(new URL("../app/api/pages/[id]/imports/route.ts", import.meta.url), "utf8");
const importArchiveRoute = readFileSync(new URL("../app/api/pages/[id]/imports/[importId]/route.ts", import.meta.url), "utf8");
const entryRoute = readFileSync(new URL("../app/api/pages/[id]/entries/[entryId]/route.ts", import.meta.url), "utf8");
const logPage = readFileSync(new URL("../app/workspace/pages/[id]/page.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
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
  assert.match(proxy, /matcher: \["\/workspace\/:path\*", "\/p\/:path\*", "\/share\/:path\*", "\/api\/:path\*"\]/);
  const publicBranch = proxy.slice(proxy.indexOf('startsWith("/p/")'));
  assert.doesNotMatch(publicBranch, /auth\.getUser/);
  assert.match(logPage, /toLogEntryDto/);
  assert.match(schema, /202608270004_log_performance\.sql/);
  const marker = "-- 202608270004_log_performance.sql";
  const nextMarker = "-- 202608280001_response_latency.sql";
  const runtimeMarker = "-- 202608280002_runtime_latency.sql";
  const settingsMarker = "-- 202608280003_workspace_settings.sql";
  const bulkMoveMarker = "-- 202608280004_bulk_resource_move.sql";
  const securityMarker = "-- 202608280005_security_hardening.sql";
  const securityFixMarker = "-- 202608280006_fix_security_rate_limit_timestamp.sql";
  const largeImportMarker = "-- 202608280007_roll20_large_import_uploads.sql";
  const stagingPolicyMarker = "-- 202608280008_roll20_staging_upload_policy.sql";
  const resourceRolesMarker = "-- 202608280009_resource_roles.sql";
  const registeredSharingMarker = "-- 202608280010_registered_resource_sharing.sql";
  const guestSharingMarker = "-- 202608280011_guest_page_sharing.sql";
  const restoreMarker = "-- 202608280012_log_restore_original.sql";
  const publicationPrivacyMarker = "-- 202608280013_publication_privacy.sql";
  const preferencesMarker = "-- 202608280014_user_preferences.sql";
  assert.equal(normalizedSql(schema.slice(schema.indexOf(marker) + marker.length, schema.indexOf(nextMarker))), normalizedSql(migration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(nextMarker) + nextMarker.length, schema.indexOf(runtimeMarker))), normalizedSql(latencyMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(runtimeMarker) + runtimeMarker.length, schema.indexOf(settingsMarker))), normalizedSql(runtimeMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(settingsMarker) + settingsMarker.length, schema.indexOf(bulkMoveMarker))), normalizedSql(settingsMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(bulkMoveMarker) + bulkMoveMarker.length, schema.indexOf(securityMarker))), normalizedSql(bulkMoveMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(securityMarker) + securityMarker.length, schema.indexOf(securityFixMarker))), normalizedSql(securityMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(securityFixMarker) + securityFixMarker.length, schema.indexOf(largeImportMarker))), normalizedSql(securityFixMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(largeImportMarker) + largeImportMarker.length, schema.indexOf(stagingPolicyMarker))), normalizedSql(largeImportMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(stagingPolicyMarker) + stagingPolicyMarker.length, schema.indexOf(resourceRolesMarker))), normalizedSql(stagingPolicyMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(resourceRolesMarker) + resourceRolesMarker.length, schema.indexOf(registeredSharingMarker))), normalizedSql(resourceRolesMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(registeredSharingMarker) + registeredSharingMarker.length, schema.indexOf(guestSharingMarker))), normalizedSql(registeredSharingMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(guestSharingMarker) + guestSharingMarker.length, schema.indexOf(restoreMarker))), normalizedSql(guestSharingMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(restoreMarker) + restoreMarker.length, schema.indexOf(publicationPrivacyMarker))), normalizedSql(restoreMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(publicationPrivacyMarker) + publicationPrivacyMarker.length, schema.indexOf(preferencesMarker))), normalizedSql(publicationPrivacyMigration));
  assert.equal(normalizedSql(schema.slice(schema.indexOf(preferencesMarker) + preferencesMarker.length)), normalizedSql(preferencesMigration));
});

test("large Roll20 imports upload directly to private staging storage", () => {
  assert.match(largeImportMigration, /roll20-import-staging[\s\S]*false[\s\S]*12582912/);
  assert.match(largeImportMigration, /create table if not exists public\.log_import_uploads/);
  assert.match(largeImportMigration, /alter table public\.log_import_uploads enable row level security/);
  assert.match(largeImportMigration, /revoke all on table public\.log_import_uploads from public, anon, authenticated/);
  assert.match(uploadRoute, /context\.isOriginalOwner/);
  assert.match(uploadRoute, /createImportUploadTarget/);
  assert.match(uploadRoute, /log-import-upload-target/);
  assert.match(stagingPolicyMigration, /create or replace function public\.can_upload_log_import/);
  assert.match(stagingPolicyMigration, /page\.original_owner_id = auth\.uid\(\)/);
  assert.match(stagingPolicyMigration, /roll20_import_staging_insert[\s\S]*for insert to authenticated/);
  assert.match(uploadHelper, /expected_size_bytes/);
  assert.match(uploadHelper, /payload\.byteLength !== Number\(intent\.expected_size_bytes\)/);
  assert.match(importRoute, /consumeImportUpload/);
  assert.match(importLimits, /MAX_DIRECT_ROLL20_SOURCE_SIZE = 4 \* 1024 \* 1024/);
  assert.match(importLimits, /MAX_STAGED_ROLL20_SOURCE_SIZE = 12 \* 1024 \* 1024/);
  assert.match(importLimits, /SUPABASE_TUS_CHUNK_SIZE = 6 \* 1024 \* 1024/);
  assert.match(importRoute, /MAX_DIRECT_ROLL20_SOURCE_SIZE/);
  assert.match(importRoute, /MAX_STAGED_ROLL20_SOURCE_SIZE/);
  assert.match(editor, /storage\/v1\/upload\/resumable/);
  assert.match(editor, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(editor, /auth\.getSession\(\)/);
  assert.match(editor, /chunkSize: SUPABASE_TUS_CHUNK_SIZE/);
  assert.match(editor, /requestBody = \{ uploadId, removeHiddenMessages \}/);
  assert.match(proxy, /contentLength > 4 \* 1024 \* 1024/);
  assert.match(purgeRoute, /purgeExpiredImportUploads/);
  assert.match(importsRoute, /context\.isOriginalOwner/);
  assert.match(importArchiveRoute, /context\.isOriginalOwner/);
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
