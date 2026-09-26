import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { AppendImportError, calculateAppendedImport, ROLL20_EDIT_SYNC_PREFIX } from "../lib/logs/import/append";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

function message(id: string, content: string, classes = "general") {
  return `<div class="message ${classes}" data-messageid="${id}"><span class="by">GM:</span><span>${content}</span></div>`;
}

test("Roll20 hidden messages and edit-sync records are always removed", () => {
  const result = importRoll20HtmlV2([
    message("visible", "보이는 로그"),
    message("hidden", "숨겨진 로그", "hidden-message"),
    message("sync", `${ROLL20_EDIT_SYNC_PREFIX}eyJ2IjoxfQ==`)
  ].join(""));

  assert.deepEqual(result.documents.map((document) => document.source.messageId), ["visible"]);
  assert.equal(result.report.hiddenRemovedCount, 1);
  assert.equal(result.report.syncRemovedCount, 1);
});

test("cumulative HTML append preserves edited and manual entries and selects only the suffix", () => {
  const currentImport = importRoll20HtmlV2(message("a", "첫째") + message("b", "둘째"));
  const nextImport = importRoll20HtmlV2(message("a", "첫째") + message("b", "둘째") + message("c", "셋째"));
  const edited = structuredClone(currentImport.entries[0].document);
  const firstText = edited.blocks.find((block) => block.type === "text");
  if (firstText?.type === "text") firstText.text = "사용자가 고친 첫째";
  const cleanupHidden = structuredClone(currentImport.entries[0].document);
  cleanupHidden.source.messageId = "legacy-hidden";
  cleanupHidden.source.messageType = "hidden-message";
  const cleanupSync = structuredClone(currentImport.entries[0].document);
  cleanupSync.source.messageId = "legacy-sync";
  const syncText = cleanupSync.blocks.find((block) => block.type === "text");
  if (syncText?.type === "text") syncText.text = `${ROLL20_EDIT_SYNC_PREFIX}legacy`;

  const plan = calculateAppendedImport([
    { id: "edited", is_added: false, document: edited, original_document: currentImport.entries[0].document },
    { id: "second", is_added: false, document: currentImport.entries[1].document, original_document: null },
    { id: "manual", is_added: true, document: currentImport.entries[0].document, original_document: null },
    { id: "hidden", is_added: false, document: cleanupHidden, original_document: null },
    { id: "sync", is_added: false, document: cleanupSync, original_document: null }
  ], nextImport.entries);

  assert.equal(plan.baselineCount, 2);
  assert.deepEqual(plan.cleanupEntryIds, ["hidden", "sync"]);
  assert.deepEqual(plan.appendedEntries.map((entry) => entry.document.source.messageId), ["c"]);
});

test("cumulative append rejects a different or truncated HTML log", () => {
  const current = importRoll20HtmlV2(message("a", "첫째") + message("b", "둘째"));
  const different = importRoll20HtmlV2(message("x", "다른 로그") + message("b", "둘째") + message("c", "셋째"));
  const existing = current.entries.map((entry, index) => ({ id: String(index), is_added: false, document: entry.document, original_document: null }));

  assert.throws(() => calculateAppendedImport(existing, different.entries), AppendImportError);
  assert.throws(() => calculateAppendedImport(existing, current.entries.slice(0, 1)), AppendImportError);
});

test("HTML import UI and migration expose refresh and append modes", () => {
  const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/pages/[id]/import/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/202609260001_html_import_modes.sql", import.meta.url), "utf8");
  assert.match(editor, /HTML 갱신/);
  assert.match(editor, /HTML 로그 추가/);
  assert.doesNotMatch(editor, /removeHiddenMessages/);
  assert.match(editor, /파일을 다시 올릴 필요가 없습니다/);
  assert.match(route, /downloadPrivateArchive\(ROLL20_SOURCE_BUCKET, latestImport\.source_storage_path\)/);
  assert.match(migration, /create or replace function public\.append_log_entries_v1/);
  assert.match(migration, /insert into public\.log_imports/);
  assert.match(migration, /delete from public\.log_entries/);
  assert.match(migration, /last_sort_key \+ item\.ordinality::bigint \* 1000000/);
});

test("append migration preserves existing rows, removes cleanup rows, and stores the new full source", async () => {
  const db = new PGlite();
  const migration = readFileSync(new URL("../supabase/migrations/202609260001_html_import_modes.sql", import.meta.url), "utf8");
  const pageId = "00000000-0000-0000-0000-000000000001";
  const logId = "00000000-0000-0000-0000-000000000002";
  const importId = "00000000-0000-0000-0000-000000000003";
  const editedId = "00000000-0000-0000-0000-000000000004";
  const manualId = "00000000-0000-0000-0000-000000000005";
  const cleanupId = "00000000-0000-0000-0000-000000000006";
  const source = message("a", "첫째") + message("b", "둘째") + message("c", "셋째");
  const imported = importRoll20HtmlV2(source);
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000099'::uuid $$;
      create table logs(id uuid primary key, page_id uuid unique not null, content_version bigint not null default 0, original_html text, platform text, import_report jsonb, visible_entry_count integer not null default 0);
      create table log_entries(id uuid primary key default gen_random_uuid(), log_id uuid not null references logs(id), order_index integer not null, sort_key bigint not null, entry_type text not null, speaker_name text, speaker_color text, content text not null, original_content text, raw_html text, metadata jsonb not null default '{}'::jsonb, document_version integer not null, document jsonb not null, original_document jsonb, has_image_content boolean not null default false, is_added boolean not null default false, is_deleted boolean not null default false);
      create table log_imports(id uuid primary key, log_id uuid not null references logs(id), source_html text, source_storage_path text, source_sha256 text, source_size_bytes bigint, compressed_size_bytes bigint, compression text, previous_generation_storage_path text, report jsonb, parsed_snapshot jsonb, replaced_entries_snapshot jsonb, parser_version integer, imported_by uuid);
      create table log_change_events(id bigserial primary key, log_id uuid not null references logs(id), event_type text not null);
      create function can_reimport_resource(uuid, uuid) returns boolean language sql stable as $$ select true $$;
    `);
    await db.exec(migration);
    await db.query("insert into logs(id,page_id,content_version,visible_entry_count,platform) values($1,$2,7,3,'roll20')", [logId, pageId]);
    await db.query("insert into log_entries(id,log_id,order_index,sort_key,entry_type,content,document_version,document,is_added) values($1,$2,0,1000000,'dialogue','edited',2,$3::jsonb,false),($4,$2,1,1500000,'system','manual',2,$3::jsonb,true),($5,$2,2,2000000,'system','sync',2,$3::jsonb,false)", [editedId, logId, JSON.stringify(imported.documents[0]), manualId, cleanupId]);
    const result = (await db.query<{ result: { count: number; appendedCount: number; cleanedCount: number; contentVersion: number } }>(
      "select append_log_entries_v1($1,$2,'latest/full.html.gz',$3,123,45,'roll20',$4::jsonb,$5::jsonb,$6::uuid[],7,'previous.json.gz') result",
      [pageId, importId, "a".repeat(64), JSON.stringify({ provider: "roll20", parserVersion: 2 }), JSON.stringify([imported.entries[2]]), [cleanupId]]
    )).rows[0].result;
    assert.deepEqual(result, { count: 3, appendedCount: 1, cleanedCount: 1, contentVersion: 8 });
    const rows = (await db.query<{ id: string; content: string; is_added: boolean }>("select id,content,is_added from log_entries order by sort_key")).rows;
    assert.deepEqual(rows.map((row) => row.id), [editedId, manualId, rows[2].id]);
    assert.equal(rows[0].content, "edited");
    assert.equal(rows[1].is_added, true);
    assert.equal(rows[2].content.includes("셋째"), true);
    const archive = (await db.query<{ source_storage_path: string; previous_generation_storage_path: string }>("select source_storage_path,previous_generation_storage_path from log_imports where id=$1", [importId])).rows[0];
    assert.deepEqual(archive, { source_storage_path: "latest/full.html.gz", previous_generation_storage_path: "previous.json.gz" });
  } finally {
    await db.close();
  }
});
