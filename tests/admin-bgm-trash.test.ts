import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { bgmUsageLabel, recentBgmUpload } from "../lib/bgm-admin";
import { drainStorageDeletionQueue } from "../lib/storage-cleanup";
import type { SupabaseClient } from "@supabase/supabase-js";

const migration = readFileSync(new URL("../supabase/migrations/202609180001_admin_bgm_and_trash.sql", import.meta.url), "utf8");
const refinement = readFileSync(new URL("../supabase/migrations/202609180002_bgm_edit_and_neutral_theme.sql", import.meta.url), "utf8");
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ADMIN = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const OTHER = "00000000-0000-0000-0000-000000000003";
const PAGE = "00000000-0000-0000-0000-000000000010";
const ASSET = "00000000-0000-0000-0000-000000000020";

test("BGM usage labels distinguish pages, playlists, library-only and tombstones", () => {
  const asset = { pages: [], playlists: [], libraries: [], deletedAt: null, ready: true };
  assert.equal(bgmUsageLabel(asset), "연결 없음");
  assert.equal(bgmUsageLabel({ ...asset, libraries: ["나"] }), "보관함에만 존재");
  assert.equal(bgmUsageLabel({ ...asset, playlists: [{ title: "음악", owner: "나" }] }), "플레이리스트에만 등록됨");
  assert.equal(bgmUsageLabel({ ...asset, pages: [{ title: "로그", deleted: false, role: "waiting", entryDeleted: false }] }), "페이지에 등록됨");
  assert.equal(bgmUsageLabel({ ...asset, deletedAt: "2026-01-01" }), "삭제 대기 / 재시도 가능");
  assert.equal(bgmUsageLabel({ ...asset, ready: false }), "업로드 미완료");
  const now = Date.parse("2026-09-18T12:00:00Z");
  assert.equal(recentBgmUpload({ sourceType: "upload", createdAt: "2026-09-17T12:00:00Z" }, now), false);
  assert.equal(recentBgmUpload({ sourceType: "upload", createdAt: "2026-09-17T12:00:01Z" }, now), true);
  assert.equal(recentBgmUpload({ sourceType: "youtube", createdAt: "2026-09-18T12:00:00Z" }, now), false);
});

test("site admin BGM and owner trash SQL execute against isolated PostgreSQL", async (t) => {
  const db = new PGlite();
  const actor = async (id: string) => { await db.query("select set_config('test.actor', $1, false)", [id]); };
  const count = async (table: string) => (await db.query<{ count: number }>(`select count(*)::int as count from public.${table}`)).rows[0].count;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
      create table profiles(id uuid primary key, username text, display_name text, account_status text, is_site_admin boolean);
      create table user_preferences(user_id uuid primary key, accent_color text default '#4F6BED', created_at timestamptz default now(), updated_at timestamptz default now());
      create function is_account_approved(actor uuid) returns boolean language sql stable as $$ select exists(select 1 from profiles where id = actor and account_status = 'approved') $$;
      create function is_site_admin(actor uuid) returns boolean language sql stable as $$ select exists(select 1 from profiles where id = actor and is_site_admin) $$;
      create table pages(id uuid primary key, original_owner_id uuid, title text, deleted_at timestamptz, session_card_path text, parent_id uuid references pages(id) on delete set null);
      create function is_original_resource_owner(resource uuid, actor uuid) returns boolean language sql stable as $$ select exists(select 1 from pages where id = resource and original_owner_id = actor and deleted_at is null) $$;
      create table logs(id uuid primary key, page_id uuid references pages(id) on delete cascade);
      create table log_entries(id uuid primary key, log_id uuid references logs(id) on delete cascade, is_deleted boolean default false);
      create table log_change_events(log_id uuid references logs(id) on delete cascade, entry_id uuid, event_type text);
      create table log_entry_revisions(id uuid primary key, entry_id uuid references log_entries(id) on delete cascade);
      create table bgm_assets(id uuid primary key, owner_user_id uuid, source_type text, canonical_title text, byte_size int, storage_path text, is_ready boolean default false, deleted_at timestamptz, created_at timestamptz default now(), youtube_video_id text, youtube_url text);
      create table bgm_library_items(id uuid default gen_random_uuid(), bgm_asset_id uuid references bgm_assets(id) on delete restrict, user_id uuid, custom_title text);
      create table bgm_playlists(id uuid primary key, title text, user_id uuid);
      create table bgm_playlist_items(id uuid default gen_random_uuid(), bgm_asset_id uuid references bgm_assets(id) on delete restrict, playlist_id uuid references bgm_playlists(id));
      create table page_bgm_items(id uuid default gen_random_uuid(), bgm_asset_id uuid references bgm_assets(id) on delete restrict, page_id uuid references pages(id) on delete cascade, entry_id uuid references log_entries(id) on delete cascade, role text);
      create table handouts(id uuid primary key, page_id uuid references pages(id) on delete cascade);
      create table handout_images(id uuid primary key, handout_id uuid references handouts(id) on delete cascade, storage_path text);
      create table log_imports(id uuid primary key, log_id uuid references logs(id) on delete cascade, source_storage_path text, previous_generation_storage_path text);
      create table log_import_uploads(id uuid primary key, page_id uuid references pages(id) on delete cascade, storage_path text);
      insert into profiles values ('${ADMIN}', 'admin', '관리자', 'approved', true), ('${USER}', 'member', '회원', 'approved', false), ('${OTHER}', 'other', '다른 회원', 'approved', false);
    `);
    await db.exec(migration);
    await db.exec("create trigger log_entries_emit_change after insert or update or delete on log_entries for each row execute function emit_log_entry_change()");
    // Repeat execution must be safe when a SQL editor reruns the migration.
    await db.exec(migration);

    await t.test("anonymous, ordinary users and disabled admins are rejected", async () => {
      await actor("");
      await assert.rejects(db.query("select admin_bgm_inventory()"), /permission denied/);
      await actor(USER);
      await assert.rejects(db.query("select admin_bgm_inventory()"), /permission denied/);
      await assert.rejects(db.query("select prepare_admin_bgm_delete($1)", [ASSET]), /permission denied/);
      await actor(ADMIN);
      await db.query("update profiles set account_status='disabled' where id=$1", [ADMIN]);
      await assert.rejects(db.query("select admin_bgm_inventory()"), /permission denied/);
      await db.query("update profiles set account_status='approved' where id=$1", [ADMIN]);
    });

    await t.test("inventory includes all users and all references; source paths are not returned", async () => {
      await db.exec(`
        insert into pages values ('${PAGE}', '${USER}', '공유 로그', null, null, null);
        insert into bgm_assets(id,owner_user_id,source_type,canonical_title,byte_size,storage_path,is_ready,deleted_at,created_at) values ('${ASSET}', '${USER}', 'upload', '피아노', 3000000, '${USER}/${ASSET}.mp3', true, null, now() - interval '2 days');
        insert into bgm_library_items(bgm_asset_id,user_id) values ('${ASSET}','${USER}'), ('${ASSET}','${OTHER}');
        insert into bgm_playlists values ('00000000-0000-0000-0000-000000000030','공동 음악','${OTHER}');
        insert into bgm_playlist_items(bgm_asset_id,playlist_id) values ('${ASSET}','00000000-0000-0000-0000-000000000030');
        insert into page_bgm_items(bgm_asset_id,page_id,role) values ('${ASSET}','${PAGE}','waiting');
      `);
      const data = (await db.query<{ inventory: { total: number; totalBytes: number; assets: Array<{ pages: unknown[]; playlists: unknown[]; libraries: unknown[] }> } }>("select admin_bgm_inventory() inventory")).rows[0].inventory;
      assert.equal(data.total, 1); assert.equal(data.totalBytes, 3000000);
      assert.equal(data.assets[0].pages.length, 1); assert.equal(data.assets[0].playlists.length, 1); assert.equal(data.assets[0].libraries.length, 2);
      assert.doesNotMatch(JSON.stringify(data), /storagePath|storage_path|\.mp3/);
      assert.equal((await db.query<{ result: { matching: number } }>("select admin_bgm_inventory('存在しない',0) result")).rows[0].result.matching, 0);
    });

    await t.test("permanent-delete preparation tombstones and detaches every reference atomically", async () => {
      const data = (await db.query<{ prepared: { id: string; storagePath: string } }>("select prepare_admin_bgm_delete($1) prepared", [ASSET])).rows[0].prepared;
      assert.equal(data.id, ASSET); assert.equal(data.storagePath, `${USER}/${ASSET}.mp3`);
      assert.equal(await count("bgm_library_items"), 0); assert.equal(await count("bgm_playlist_items"), 0); assert.equal(await count("page_bgm_items"), 0);
      assert.equal(await count("bgm_assets"), 1); // recoverable until Storage succeeds
      await db.query("select prepare_admin_bgm_delete($1)", [ASSET]); // retry
      for (const table of ["bgm_library_items", "bgm_playlist_items", "page_bgm_items"]) {
        await assert.rejects(db.query(`insert into ${table}(bgm_asset_id) values ($1)`, [ASSET]), /unavailable/);
      }
      await assert.rejects(db.query("update bgm_assets set deleted_at=null where id=$1", [ASSET]), /cannot be reactivated/);
      await assert.rejects(db.query("update bgm_assets set storage_path='other.mp3' where id=$1", [ASSET]), /immutable/);
      await db.query("delete from bgm_assets where id=$1", [ASSET]);
    });

    await t.test("fresh uploads cannot be purged or have their creation time backdated", async () => {
      await db.query("insert into bgm_assets(id,owner_user_id,source_type,canonical_title,storage_path,is_ready) values ($1,$2,'upload','업로드',$3,true)", [ASSET, USER, `${USER}/${ASSET}.mp3`]);
      await assert.rejects(db.query("select prepare_admin_bgm_delete($1)", [ASSET]), /24 hours/);
      await assert.rejects(db.query("update bgm_assets set created_at=now()-interval '2 days' where id=$1", [ASSET]), /immutable/);
      await assert.rejects(db.query("insert into bgm_assets(id,owner_user_id,source_type,storage_path) values (gen_random_uuid(),$1,'upload',$2)", [OTHER, `${USER}/${ASSET}.mp3`]), /invalid BGM storage path/);
    });

    await t.test("empty resource trash preserves other owners and live children; queues cascaded private files", async () => {
      await actor(USER);
      await db.exec(`
        update pages set deleted_at=now(), session_card_path='card.png' where id='${PAGE}';
        insert into pages values ('00000000-0000-0000-0000-000000000011','${OTHER}','他人のゴミ',now(),null,null), ('00000000-0000-0000-0000-000000000012','${OTHER}','子ページ',null,null,'${PAGE}');
        insert into logs values ('00000000-0000-0000-0000-000000000040','${PAGE}');
        insert into log_entries values (gen_random_uuid(),'00000000-0000-0000-0000-000000000040',false);
        insert into handouts values ('00000000-0000-0000-0000-000000000050','${PAGE}');
        insert into handout_images values (gen_random_uuid(),'00000000-0000-0000-0000-000000000050','handout.png');
        insert into log_imports values (gen_random_uuid(),'00000000-0000-0000-0000-000000000040','source.gz','generation.gz');
        insert into log_import_uploads values (gen_random_uuid(),'${PAGE}','pending.html');
      `);
      assert.equal((await db.query<{ removed: number }>("select empty_resource_trash() removed")).rows[0].removed, 1);
      assert.equal(await count("pages"), 2);
      const child = (await db.query<{ parent_id: string | null }>("select parent_id from pages where title='子ページ'")).rows[0];
      assert.equal(child.parent_id, null);
      assert.equal(await count("storage_deletion_queue"), 5);
      assert.equal(await count("log_change_events"), 0);
      assert.equal((await db.query<{ removed: number }>("select empty_resource_trash() removed")).rows[0].removed, 0);
    });

    await t.test("only original owners can purge deleted messages and revisions; active messages remain", async () => {
      await db.exec(`
        insert into pages values ('${PAGE}','${USER}','로그',null,null,null);
        insert into logs values ('00000000-0000-0000-0000-000000000040','${PAGE}');
        insert into log_entries values ('00000000-0000-0000-0000-000000000060','00000000-0000-0000-0000-000000000040',true), ('00000000-0000-0000-0000-000000000061','00000000-0000-0000-0000-000000000040',false);
        insert into log_entry_revisions values (gen_random_uuid(),'00000000-0000-0000-0000-000000000060');
      `);
      await actor(OTHER); await assert.rejects(db.query("select empty_log_entry_trash($1)", [PAGE]), /permission denied/);
      await actor(ADMIN); await assert.rejects(db.query("select empty_log_entry_trash($1)", [PAGE]), /permission denied/);
      await actor(USER);
      assert.equal((await db.query<{ removed: number }>("select empty_log_entry_trash($1) removed", [PAGE])).rows[0].removed, 1);
      assert.equal(await count("log_entries"), 1); assert.equal(await count("log_entry_revisions"), 0);
      assert.equal((await db.query<{ count: number }>("select count(*)::int count from log_change_events where event_type='deleted'")).rows[0].count, 1);
    });

    await t.test("cleanup paths cannot be read or altered by authenticated users", async () => {
      await db.exec("set role authenticated");
      await assert.rejects(db.query("select * from storage_deletion_queue"), /permission denied/);
      await assert.rejects(db.query("delete from storage_deletion_queue"), /permission denied/);
      await db.exec("reset role");
    });

    await t.test("inventory pagination exposes more than 100 assets without clipping totals", async () => {
      await actor(ADMIN);
      await db.query("insert into bgm_assets(id,owner_user_id,source_type,canonical_title,is_ready) select gen_random_uuid(),$1,'youtube','곡 '||n,true from generate_series(1,205) n", [OTHER]);
      const results = [];
      for (const offset of [0, 100, 200]) results.push((await db.query<{ result: { total: number; matching: number; assets: Array<{ id: string }> } }>("select admin_bgm_inventory('', $1) result", [offset])).rows[0].result);
      assert.deepEqual(results.map((result) => result.assets.length), [100, 100, 6]);
      assert.equal(results[0].total, 206); assert.equal(results[0].matching, 206);
      assert.equal(new Set(results.flatMap((result) => result.assets.map((asset) => asset.id))).size, 206);
    });

    await t.test("neutral default migration preserves custom and previously edited blue colors", async () => {
      await db.exec(`insert into user_preferences values ('${USER}','#4F6BED',now()-interval '2 days',now()-interval '2 days'), ('${OTHER}','#4F6BED',now()-interval '2 days',now()), ('${ADMIN}','#C2200E',now()-interval '2 days',now());`);
      await db.exec(refinement); await db.exec(refinement);
      const colors = (await db.query<{ user_id: string; accent_color: string }>("select * from user_preferences")).rows;
      assert.equal(colors.find((row) => row.user_id === USER)?.accent_color, "#62625F");
      assert.equal(colors.find((row) => row.user_id === OTHER)?.accent_color, "#4F6BED");
      assert.equal(colors.find((row) => row.user_id === ADMIN)?.accent_color, "#C2200E");
      assert.equal((await db.query<{ accent_color: string }>("insert into user_preferences(user_id) values(gen_random_uuid()) returning accent_color")).rows[0].accent_color, "#62625F");
    });

    await t.test("owner YouTube edits update the shared asset without duplicating references; aliases stay personal", async () => {
      const youtube = "00000000-0000-0000-0000-000000000021";
      const mine = "00000000-0000-0000-0000-000000000071";
      const other = "00000000-0000-0000-0000-000000000072";
      await db.exec(`insert into bgm_assets(id,owner_user_id,source_type,canonical_title,is_ready,youtube_video_id,youtube_url) values ('${youtube}','${USER}','youtube','유튜브',true,'dQw4w9WgXcQ','https://www.youtube.com/watch?v=dQw4w9WgXcQ'); insert into bgm_library_items(id,bgm_asset_id,user_id) values ('${mine}','${youtube}','${USER}'),('${other}','${youtube}','${OTHER}'); insert into page_bgm_items(bgm_asset_id,page_id,role) values ('${youtube}','${PAGE}','waiting'); insert into bgm_playlist_items(bgm_asset_id,playlist_id) values ('${youtube}','00000000-0000-0000-0000-000000000030');`);
      await actor(USER);
      const before = await count("bgm_assets");
      const result = (await db.query<{ result: { sourceUpdated: boolean } }>("select update_bgm_library_details($1,'새 이름','abcdefghijk') result", [mine])).rows[0].result;
      assert.equal(result.sourceUpdated, true); assert.equal(await count("bgm_assets"), before);
      const asset = (await db.query<{ youtube_video_id: string; youtube_url: string; canonical_title: string }>("select * from bgm_assets where id=$1", [youtube])).rows[0];
      assert.equal(asset.youtube_video_id, "abcdefghijk"); assert.equal(asset.youtube_url, "https://www.youtube.com/watch?v=abcdefghijk"); assert.equal(asset.canonical_title, "유튜브");
      assert.equal(await count("page_bgm_items"), 1); assert.equal(await count("bgm_playlist_items"), 1);
      await actor(OTHER);
      await db.query("select update_bgm_library_details($1,'내 별칭',null)", [other]);
      await assert.rejects(db.query("select update_bgm_library_details($1,'잘못된 이름','lmnopqrstuv')", [other]), /only source owner/);
      assert.equal((await db.query<{ custom_title: string }>("select custom_title from bgm_library_items where id=$1", [other])).rows[0].custom_title, "내 별칭");
      await assert.rejects(db.query("select update_bgm_library_details($1,'다른 사람 보관함',null)", [mine]), /library item not found/);
      await assert.rejects(db.query("select update_bgm_library_details($1,'이름','bad')", [other]), /invalid YouTube video/);
      await actor(ADMIN);
      const adminLibrary = (await db.query<{ id: string }>("insert into bgm_library_items(bgm_asset_id,user_id) values ($1,$2) returning id", [youtube, ADMIN])).rows[0].id;
      await db.query("select update_bgm_library_details($1,'관리자 별칭','lmnopqrstuv')", [adminLibrary]);
      assert.equal((await db.query<{ youtube_video_id: string }>("select youtube_video_id from bgm_assets where id=$1", [youtube])).rows[0].youtube_video_id, "lmnopqrstuv");
    });

    await t.test("inventory usage filters run before pagination and retain trash-page references as usage", async () => {
      await actor(ADMIN);
      const lib = "00000000-0000-0000-0000-000000000080";
      const playlist = "00000000-0000-0000-0000-000000000081";
      const none = "00000000-0000-0000-0000-000000000082";
      await db.exec(`update bgm_assets set canonical_title='filter-page' where id='00000000-0000-0000-0000-000000000021'; update pages set deleted_at=now() where id='${PAGE}'; insert into bgm_assets(id,owner_user_id,source_type,canonical_title,is_ready) values ('${lib}','${USER}','youtube','filter-library',true),('${playlist}','${USER}','youtube','filter-playlist',true),('${none}','${USER}','youtube','filter-none',true); insert into bgm_library_items(bgm_asset_id,user_id) values ('${lib}','${USER}'); insert into bgm_playlist_items(bgm_asset_id,playlist_id) values ('${playlist}','00000000-0000-0000-0000-000000000030');`);
      for (const [filter, expected] of [["all", 4], ["no-page", 3], ["library-only", 1], ["unreferenced", 1]] as const) {
        const result = (await db.query<{ result: { matching: number; assets: unknown[] } }>("select admin_bgm_inventory('filter-',0,$1) result", [filter])).rows[0].result;
        assert.equal(result.matching, expected); assert.equal(result.assets.length, expected);
      }
      await assert.rejects(db.query("select admin_bgm_inventory('',0,'invalid')"), /invalid usage filter/);
      await actor(USER); await assert.rejects(db.query("select admin_bgm_inventory('',0,'all')"), /permission denied/);
    });
  } finally { await db.close(); }
});

test("admin and trash UI/API keep permission boundaries and destructive confirmation", () => {
  const route = read("app/api/admin/bgm/route.ts");
  assert.equal((route.match(/getSiteAdminApiContext\(\)/g) ?? []).length, 2);
  assert.match(route, /PERMANENTLY_DELETE/); assert.match(route, /prepare_admin_bgm_delete/);
  assert.ok(route.indexOf("storage.from(BGM_AUDIO_BUCKET).remove") < route.indexOf('from("bgm_assets").delete'));
  assert.match(read("app/workspace/admin/layout.tsx"), /!session.profile.is_site_admin/);
  assert.match(read("components/AdminBgmPanel.tsx"), /confirmation !== selected.title/);
  assert.match(read("components/WorkspaceSidebar.tsx"), /isSiteAdmin && <Link className="sidebar-action" href="\/workspace\/admin\/accounts"><ShieldCheck size=\{15\} \/>관리<\/Link>/);
  assert.match(read("components/TrashDialog.tsx"), /role="dialog" aria-modal="true"/);
  assert.match(read("app/api/resources/trash/route.ts"), /EMPTY_TRASH/);
  assert.match(read("app/api/pages/[id]/trash/route.ts"), /!context\?\.isOriginalOwner/);
});

test("square color chips, aligned soft buttons and neutral overview preserve content CSS", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.button \{ display: inline-flex; align-items: center; justify-content: center; gap: 6px/);
  assert.match(css, /\.button > svg \{ flex: 0 0 auto; display: block/);
  assert.match(css, /\.accent-color-chip::-webkit-color-swatch-wrapper \{ padding: 0/);
  assert.match(css, /\.accent-color-chip::-moz-color-swatch/);
  assert.match(css, /\.page-overview \{[^}]*border: 1px solid var\(--line\); border-radius: 6px; background: transparent/);
  assert.match(read("lib/use-escape-close.ts"), /closeStack.at\(-1\) === token/);
  const schema = read("supabase/schema.sql");
  assert.equal(schema.slice(schema.indexOf("-- 202609180001_admin_bgm_and_trash.sql") + "-- 202609180001_admin_bgm_and_trash.sql".length, schema.indexOf("-- 202609180002_bgm_edit_and_neutral_theme.sql")).trim(), migration.trim());
});

test("Storage cleanup retries failures and deletes queue metadata only after file removal", async () => {
  const deleted: string[] = [];
  const attempted: string[] = [];
  const rows = [
    { id: "failed", bucket: "handout-images", storage_path: "failed.png" },
    { id: "success", bucket: "session-cards", storage_path: "ok.png" }
  ];
  const admin = {
    from: () => ({
      select: () => ({ order: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }),
      delete: () => ({ eq: async (_key: string, id: string) => { deleted.push(id); return { error: null }; } })
    }),
    storage: { from: () => ({ remove: async ([path]: string[]) => { attempted.push(path); return { error: path === "failed.png" ? new Error("offline") : null }; } }) }
  } as unknown as SupabaseClient;
  assert.equal(await drainStorageDeletionQueue(admin), 1);
  assert.deepEqual(attempted, ["failed.png", "ok.png"]); assert.deepEqual(deleted, ["success"]);
});
