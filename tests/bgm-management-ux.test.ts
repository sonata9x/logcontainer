import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { normalizeBgmOriginalFilename } from "../lib/bgm";

const migration = readFileSync(new URL("../supabase/migrations/202609210001_bgm_management_ux.sql", import.meta.url), "utf8");
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const USER = "00000000-0000-0000-0000-000000000001";
const OTHER = "00000000-0000-0000-0000-000000000002";
const PLAYLIST = "00000000-0000-0000-0000-000000000010";
const ASSET_A = "00000000-0000-0000-0000-000000000021";
const ASSET_B = "00000000-0000-0000-0000-000000000022";
const ASSET_OTHER = "00000000-0000-0000-0000-000000000023";

test("original MP3 names are normalized without accepting paths or other formats", () => {
  assert.equal(normalizeBgmOriginalFilename("C:\\fakepath\\시간이 데려온 운명.MP3"), "시간이 데려온 운명.MP3");
  assert.equal(normalizeBgmOriginalFilename("folder/track.mp3"), "track.mp3");
  assert.equal(normalizeBgmOriginalFilename("bad.wav"), null);
  assert.equal(normalizeBgmOriginalFilename("\u0000song.mp3"), "song.mp3");
});

test("bulk playlist addition and reorder are authorized and atomic", async () => {
  const db = new PGlite();
  const actor = (id: string) => db.query("select set_config('test.actor', $1, false)", [id]);
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
      create table profiles(id uuid primary key, account_status text);
      create function is_account_approved(actor uuid) returns boolean language sql stable as $$ select exists(select 1 from profiles where id=actor and account_status='approved') $$;
      create table bgm_assets(id uuid primary key, owner_user_id uuid, source_type text not null default 'upload', storage_path text, is_ready boolean not null default false, deleted_at timestamptz, created_at timestamptz not null default now());
      create table bgm_library_items(id uuid primary key default gen_random_uuid(), user_id uuid, bgm_asset_id uuid references bgm_assets(id), unique(user_id,bgm_asset_id));
      create table bgm_playlists(id uuid primary key, user_id uuid, title text);
      create table bgm_playlist_items(id uuid primary key default gen_random_uuid(), playlist_id uuid references bgm_playlists(id), bgm_asset_id uuid references bgm_assets(id), custom_title text, sort_order integer not null default 0, created_at timestamptz default now(), unique(playlist_id,bgm_asset_id));
      insert into profiles values ('${USER}','approved'),('${OTHER}','approved');
      insert into bgm_assets(id,owner_user_id,storage_path,is_ready) values ('${ASSET_A}','${USER}','${USER}/${ASSET_A}.mp3',true),('${ASSET_B}','${USER}','${USER}/${ASSET_B}.mp3',true),('${ASSET_OTHER}','${OTHER}','${OTHER}/${ASSET_OTHER}.mp3',true);
      insert into bgm_library_items(user_id,bgm_asset_id) values ('${USER}','${ASSET_A}'),('${USER}','${ASSET_B}'),('${OTHER}','${ASSET_OTHER}');
      insert into bgm_playlists values ('${PLAYLIST}','${USER}','내 목록'),('00000000-0000-0000-0000-000000000011','${OTHER}','다른 목록');
    `);
    await db.exec(migration);
    await db.exec(migration);
    await actor(USER);
    const result = (await db.query<{ result: { addedCount: number; existingCount: number } }>(`select add_bgm_playlist_items('${PLAYLIST}',array['${ASSET_B}','${ASSET_A}','${ASSET_B}']::uuid[]) result`)).rows[0].result;
    assert.deepEqual(result, { addedCount: 2, existingCount: 0 });
    let items = (await db.query<{ id: string; bgm_asset_id: string; sort_order: number }>("select id,bgm_asset_id,sort_order from bgm_playlist_items order by sort_order")).rows;
    assert.deepEqual(items.map((item) => item.bgm_asset_id), [ASSET_B, ASSET_A]);

    const repeated = (await db.query<{ result: { addedCount: number; existingCount: number } }>(`select add_bgm_playlist_items('${PLAYLIST}',array['${ASSET_A}','${ASSET_B}']::uuid[]) result`)).rows[0].result;
    assert.deepEqual(repeated, { addedCount: 0, existingCount: 2 });
    await assert.rejects(db.query(`select add_bgm_playlist_items('${PLAYLIST}',array['${ASSET_A}','${ASSET_OTHER}']::uuid[])`), /library access required/);
    assert.equal((await db.query<{ count: number }>("select count(*)::int count from bgm_playlist_items")).rows[0].count, 2);

    await db.query("select reorder_bgm_playlist_items($1,$2::uuid[])", [PLAYLIST, [items[1].id, items[0].id]]);
    items = (await db.query<{ id: string; bgm_asset_id: string; sort_order: number }>("select id,bgm_asset_id,sort_order from bgm_playlist_items order by sort_order")).rows;
    assert.deepEqual(items.map((item) => item.bgm_asset_id), [ASSET_A, ASSET_B]);
    await assert.rejects(db.query("select reorder_bgm_playlist_items($1,$2::uuid[])", [PLAYLIST, [items[0].id]]), /does not match/);
    await actor(OTHER);
    await assert.rejects(db.query(`select add_bgm_playlist_items('${PLAYLIST}',array['${ASSET_OTHER}']::uuid[])`), /playlist not found/);

    await assert.rejects(db.query("update bgm_assets set original_filename=$1 where id=$2", ["x".repeat(256), ASSET_A]), /bgm_assets_original_filename_length/);
    await db.query("update bgm_assets set original_filename='원본 제목.mp3' where id=$1", [ASSET_A]);
    await db.exec("create trigger bgm_source_identity before insert or update on bgm_assets for each row execute function guard_bgm_source_identity()");
    await assert.rejects(db.query("update bgm_assets set original_filename='다른 이름.mp3' where id=$1", [ASSET_A]), /immutable/);
  } finally { await db.close(); }
});

test("BGM manager exposes batch uploads, multi-select, collapse and drag ordering", () => {
  const manager = read("components/BgmManager.tsx");
  const upload = read("components/BgmUploadDialog.tsx");
  const picker = read("components/BgmDetailsDialog.tsx");
  const api = read("app/api/bgm/playlists/items/route.ts");
  assert.match(manager, /multiple onChange=/);
  assert.match(manager, /originalFilename: file\.name/);
  assert.match(manager, /localStorage\.setItem\(COLLAPSED_KEY/);
  assert.match(manager, /draggable onDragStart=/);
  assert.match(manager, /originalFileLabel\(item\.asset\)/);
  assert.match(upload, /MP3 일괄 업로드/);
  assert.match(upload, /실패한 곡 재시도/);
  assert.match(picker, /type="checkbox"/);
  assert.match(picker, /전체 선택/);
  assert.match(api, /rpc\("add_bgm_playlist_items"/);
  assert.match(api, /rpc\("reorder_bgm_playlist_items"/);
});
