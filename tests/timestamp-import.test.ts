import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { calculateTimestampImport } from "../lib/logs/import/timestamps";
import { importRoll20HtmlV2 } from "../lib/logs/roll20/import-v2";

function source(timestamp: string, speaker: string, content: string) {
  return `<div class="message general" data-messageid="message-1"><span class="tstamp">${timestamp}</span><span class="by">${speaker}:</span><span>${content}</span></div>`;
}

test("timestamp-only import preserves rendered content and stores the dated timestamp revision", async () => {
  const db = new PGlite();
  const migration = readFileSync(new URL("../supabase/migrations/202610070001_timestamp_overwrite_import.sql", import.meta.url), "utf8");
  const pageId = "00000000-0000-0000-0000-000000000001";
  const logId = "00000000-0000-0000-0000-000000000002";
  const entryId = "00000000-0000-0000-0000-000000000003";
  const importId = "00000000-0000-0000-0000-000000000004";
  const current = importRoll20HtmlV2(source("July 07, 2026 12:05AM", "GM", "원문"));
  const incoming = importRoll20HtmlV2(source("July 08, 2026 1:25AM", "다른 화자", "다른 내용"));
  const edited = structuredClone(current.entries[0].document);
  edited.speaker = { name: "사용자 화자", color: null, avatarUrl: null };
  if (edited.blocks[0].type === "text") edited.blocks[0].text = "사용자 수정 내용";
  const plan = calculateTimestampImport([{ id: entryId, is_added: false, document: edited }], incoming.entries);

  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select '00000000-0000-0000-0000-000000000099'::uuid $$;
      create table logs(id uuid primary key, page_id uuid unique not null, content_version bigint not null default 0, original_html text, platform text, import_report jsonb, visible_entry_count integer not null default 0);
      create table log_entries(id uuid primary key, log_id uuid not null references logs(id), content text not null, document_version integer, document jsonb, original_document jsonb, is_added boolean not null default false, updated_by uuid);
      create table log_entry_revisions(id uuid primary key default gen_random_uuid(), entry_id uuid references log_entries(id), editor_id uuid, action text check(action in ('edit','delete','restore','revert')), previous_content text, next_content text, previous_snapshot jsonb, next_snapshot jsonb, revision_schema_version integer);
      create table log_imports(id uuid primary key, log_id uuid references logs(id), source_html text, source_storage_path text, source_sha256 text, source_size_bytes bigint, compressed_size_bytes bigint, compression text, previous_generation_storage_path text, report jsonb, parsed_snapshot jsonb, replaced_entries_snapshot jsonb, parser_version integer, imported_by uuid);
      create table log_change_events(id bigserial primary key, log_id uuid references logs(id), event_type text);
      create function can_reimport_resource(uuid, uuid) returns boolean language sql stable as $$ select true $$;
    `);
    await db.exec(migration);
    await db.query("insert into logs(id,page_id,content_version,visible_entry_count,platform) values($1,$2,3,1,'roll20')", [logId, pageId]);
    await db.query("insert into log_entries(id,log_id,content,document_version,document) values($1,$2,'사용자 수정 내용',2,$3::jsonb)", [entryId, logId, JSON.stringify(edited)]);
    const result = (await db.query<{ result: { count: number; updatedCount: number; contentVersion: number } }>(
      "select overwrite_log_entry_timestamps_v1($1,$2,'source.html.gz',$3,100,80,'roll20',$4::jsonb,$5::jsonb,3,'previous.json.gz') result",
      [pageId, importId, "a".repeat(64), JSON.stringify({ provider: "roll20", parserVersion: 2 }), JSON.stringify(plan.updates)]
    )).rows[0].result;
    assert.deepEqual(result, { count: 1, updatedCount: 1, contentVersion: 4 });

    const row = (await db.query<{ document: typeof edited; original_document: typeof edited; content: string }>("select document,original_document,content from log_entries where id=$1", [entryId])).rows[0];
    assert.equal(row.content, "사용자 수정 내용");
    assert.equal(row.document.speaker?.name, "사용자 화자");
    assert.equal(row.document.blocks[0].type === "text" ? row.document.blocks[0].text : "", "사용자 수정 내용");
    assert.deepEqual(row.document.timestamp, incoming.entries[0].document.timestamp);
    assert.equal(row.document.presentation?.timestampExplicit, true);
    assert.deepEqual(row.original_document.timestamp, current.entries[0].document.timestamp);

    const revision = (await db.query<{ previous_snapshot: typeof edited; next_snapshot: typeof edited }>("select previous_snapshot,next_snapshot from log_entry_revisions where entry_id=$1", [entryId])).rows[0];
    assert.deepEqual(revision.previous_snapshot.timestamp, current.entries[0].document.timestamp);
    assert.deepEqual(revision.next_snapshot.timestamp, incoming.entries[0].document.timestamp);
  } finally {
    await db.close();
  }
});
