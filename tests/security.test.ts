import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/202608270002_personal_resources.sql", import.meta.url), "utf8");
const hardeningMigration = readFileSync(new URL("../supabase/migrations/202608270003_personal_resources_hardening.sql", import.meta.url), "utf8");
const settingsMigration = readFileSync(new URL("../supabase/migrations/202608280003_workspace_settings.sql", import.meta.url), "utf8");
const bulkMoveMigration = readFileSync(new URL("../supabase/migrations/202608280004_bulk_resource_move.sql", import.meta.url), "utf8");
const securityMigration = readFileSync(new URL("../supabase/migrations/202608280005_security_hardening.sql", import.meta.url), "utf8");
const securityFixMigration = readFileSync(new URL("../supabase/migrations/202608280006_fix_security_rate_limit_timestamp.sql", import.meta.url), "utf8");
const loginRoute = readFileSync(new URL("../app/api/login/route.ts", import.meta.url), "utf8");
const signupRoute = readFileSync(new URL("../app/api/signup/route.ts", import.meta.url), "utf8");
const adminHelper = readFileSync(new URL("../lib/admin-auth.ts", import.meta.url), "utf8");
const memberRoute = readFileSync(new URL("../app/api/members/route.ts", import.meta.url), "utf8");
const passwordRoute = readFileSync(new URL("../app/api/account/password/route.ts", import.meta.url), "utf8");
const settingsRoute = readFileSync(new URL("../app/api/account/settings/route.ts", import.meta.url), "utf8");
const childrenRoute = readFileSync(new URL("../app/api/resources/[id]/children/route.ts", import.meta.url), "utf8");
const bulkMoveRoute = readFileSync(new URL("../app/api/resources/move/route.ts", import.meta.url), "utf8");
const publicationRoute = readFileSync(new URL("../app/api/pages/[id]/publication/route.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../components/WorkspaceSidebar.tsx", import.meta.url), "utf8");
const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const serverAuth = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
const setPasswordPage = readFileSync(new URL("../app/set-password/page.tsx", import.meta.url), "utf8");
const setupRoute = readFileSync(new URL("../app/api/setup/route.ts", import.meta.url), "utf8");
const rateLimitHelper = readFileSync(new URL("../lib/rate-limit.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

function functionSql(name: string) {
  const start = migration.indexOf(`create or replace function public.${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = migration.indexOf("\n$$;", start);
  assert.ok(end > start, `${name} must have a complete SQL body`);
  return migration.slice(start, end + 4);
}

test("account approval is a database security boundary", () => {
  assert.match(migration, /account_status in \('pending', 'approved', 'rejected', 'disabled'\)/);
  assert.match(migration, /create or replace function public\.is_account_approved/);
  assert.match(migration, /if not public\.is_account_approved\(actor_id\)/);
  assert.match(loginRoute, /profile\.account_status !== "approved"/);
  assert.match(loginRoute, /관리자 승인 대기 중인 계정입니다/);
  assert.match(passwordRoute, /getApprovedApiContext/);
  assert.match(serverAuth, /requireApprovedSession/);
  assert.match(setPasswordPage, /requireApprovedSession/);
  assert.match(migration, /public\.is_account_approved\(auth\.uid\(\)\)/);
});

test("first account is admin and later signup stays pending without a session", () => {
  assert.match(migration, /case when first_account then 'approved' else 'pending' end/);
  assert.match(migration, /first_account,/);
  assert.match(migration, /profiles_one_site_admin_idx/);
  assert.match(signupRoute, /admin\.auth\.admin\.createUser/);
  assert.doesNotMatch(signupRoute, /signInWithPassword|setSession/);
});

test("approval creates one personal workspace and activates pending resource shares", () => {
  assert.match(migration, /unique index if not exists workspaces_one_per_owner_idx/);
  assert.match(migration, /create or replace function public\.moderate_account/);
  assert.match(migration, /on conflict \(owner_id\)/);
  assert.match(migration, /from public\.pending_resource_shares prs/);
  assert.match(migration, /insert into public\.workspace_items/);
});

test("site administration is separate from resource ownership", () => {
  assert.match(adminHelper, /isSiteAdmin/);
  assert.match(migration, /original_owner_id uuid/);
  assert.doesNotMatch(functionSql("can_view_resource"), /is_site_admin|isSiteAdmin/);
  assert.match(adminHelper, /if \(!context\?\.isSiteAdmin\) return null/);
});

test("resource permissions centralize direct, inherited and invitation access", () => {
  for (const helper of ["is_original_resource_owner", "has_direct_resource_share", "has_inherited_resource_access", "can_view_resource", "can_edit_resource", "can_invite_resource", "can_manage_resource_shares", "can_delete_resource"]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${helper}`));
  }
  assert.match(migration, /with recursive ancestors/);
  assert.match(functionSql("has_inherited_resource_access"), /parent\.deleted_at is null/);
  assert.match(migration, /rs\.revoked_at is null and rs\.can_invite/);
  assert.match(migration, /grant execute on function public\.can_view_resource\(uuid, uuid\) to authenticated/);
  assert.match(migration, /grant execute on function public\.can_edit_resource\(uuid, uuid\) to authenticated/);
});

test("log writes re-check page permission at save time", () => {
  for (const fn of ["replace_log_entries", "update_log_entry_content", "set_log_entry_deleted", "create_log_entry", "replace_log_entries_v2", "update_log_entry_document_v2", "create_log_entry_v2", "set_log_entry_deleted_v2"]) {
    const start = migration.indexOf(`create or replace function public.${fn}`);
    assert.ok(start >= 0, `${fn} must be replaced`);
    assert.match(migration.slice(start, start + 1800), /can_edit_resource\(target_page_id, auth\.uid\(\)\)/);
  }
  assert.match(schema, /previous_snapshot jsonb/);
  assert.match(schema, /replaced_entries_snapshot jsonb/);
});

test("sharing prevents delegated invite escalation and shared-folder access leaks", () => {
  assert.match(migration, /only the original owner can delegate invite permission/);
  assert.match(migration, /reshare permission required/);
  assert.match(migration, /can_invite_resource\(target_child_resource_id, auth\.uid\(\)\)/);
  assert.match(functionSql("insert_folder_item"), /A first insertion into the shared hierarchy is a re-share/);
  assert.match(functionSql("insert_folder_item"), /can_view_resource\(target_folder_id, audience\.id\)/);
  assert.match(childrenRoute, /insert_folder_item/);
});

test("collaborator removal revokes share while owner deletion uses 30-day trash", () => {
  assert.match(migration, /revocation_reason = 'self_remove'/);
  assert.match(migration, /purge_after = now\(\) \+ interval '30 days'/);
  assert.match(migration, /create or replace function public\.permanently_delete_resource/);
  assert.match(migration, /original_owner_id = auth\.uid\(\) and deleted_at is not null/);
  assert.match(functionSql("self_remove_resource"), /has_direct_resource_share/);
  assert.match(sidebar, /page\.can_self_remove/);
  assert.match(functionSql("remove_folder_item"), /insert into public\.workspace_items/);
});

test("legacy workspace member creation API is retired", () => {
  assert.match(memberRoute, /워크스페이스 멤버 기능은 종료되었습니다/);
  assert.doesNotMatch(memberRoute, /workspace_members.*insert|pending_accounts.*upsert/);
});

test("personal settings update only the approved account and its one owned workspace", () => {
  assert.match(settingsMigration, /create or replace function public\.update_personal_settings/);
  assert.match(settingsMigration, /is_account_approved\(actor_id\)/);
  assert.match(settingsMigration, /where owner_id = actor_id[\s\S]*for update/);
  assert.match(settingsMigration, /where id = actor_id/);
  assert.match(settingsMigration, /display_name = normalized_nickname/);
  assert.match(settingsRoute, /getAuthenticatedApiContext/);
  assert.match(settingsRoute, /update_personal_settings/);
  assert.doesNotMatch(sidebar, /onContextMenu/);
  assert.match(sidebar, /aria-haspopup="menu"/);
  assert.match(sidebar, />닉네임<input/);
  assert.match(sidebar, /event\.stopPropagation\(\); const rect/);
  assert.match(sidebar, /addEventListener\("pointerdown", close\)/);
  assert.match(sidebar, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(globalCss, /\.tree-more \{[^}]*opacity: 0;[^}]*pointer-events: none/);
  assert.match(globalCss, /\.tree-row:hover \.tree-more, \.tree-row:focus-within \.tree-more \{ opacity: 1; pointer-events: auto; \}/);
  assert.match(sidebar, /mobile-sidebar-toggle/);
  assert.match(sidebar, /workspace-sidebar-scrim/);
  assert.match(sidebar, /mobileSidebarOpen/);
  assert.match(sidebar, /event\.key === "Escape"/);
  assert.match(globalCss, /@media \(max-width: 960px\)/);
  assert.match(globalCss, /\.workspace-sidebar\.mobile-open \{[^}]*left: 0;[^}]*visibility: visible/);
  assert.match(globalCss, /\.workspace-sidebar-scrim\.is-open/);
  assert.match(globalCss, /--log-column-width: 680px/);
  assert.match(globalCss, /\.workspace-content \{ width: min\(var\(--log-column-width\), calc\(100% - 24px\)\)/);
  assert.match(globalCss, /\.public-log \{ width: min\(var\(--log-column-width\)/);
  assert.match(globalCss, /\.modal-backdrop \{[^}]*z-index: 100/);
});

test("resource tree supports portal overlays, range selection and atomic drag moves", () => {
  assert.match(sidebar, /createPortal\(children, document\.body\)/);
  assert.match(sidebar, /event\.ctrlKey.*event\.metaKey.*event\.shiftKey/);
  assert.match(sidebar, /querySelectorAll<HTMLElement>\("#workspace-navigation \[data-resource-id\]"\)/);
  assert.match(sidebar, /draggable/);
  assert.match(sidebar, /RESOURCE_DRAG_TYPE/);
  assert.match(sidebar, /fetch\("\/api\/resources\/move"/);
  assert.match(sidebar, /workspace-root-drop/);
  assert.match(globalCss, /\.tree-row\.selected/);
  assert.match(globalCss, /\.tree-row\.drop-target/);

  assert.match(bulkMoveRoute, /getAuthenticatedApiContext/);
  assert.match(bulkMoveRoute, /move_resources_bulk/);
  assert.match(bulkMoveRoute, /resourceIds\.length > 100/);
  assert.match(bulkMoveMigration, /is_account_approved\(actor_id\)/);
  assert.match(bulkMoveMigration, /public\.insert_folder_item\(target_folder_id, resource_id, next_order\)/);
  assert.match(bulkMoveMigration, /public\.remove_folder_item\(source_folder_id, resource_id\)/);
  assert.match(bulkMoveMigration, /public\.move_workspace_item\(resource_id, null, next_order\)/);
  assert.match(bulkMoveMigration, /grant execute on function public\.move_resources_bulk\(uuid\[\], uuid\) to authenticated/);
});

test("personal workspace migration is idempotent and keeps one workspace per account", () => {
  assert.match(migration, /create unique index if not exists workspaces_one_per_owner_idx/);
  assert.match(functionSql("moderate_account"), /on conflict \(owner_id\)/);
  assert.match(functionSql("moderate_account"), /on conflict \(workspace_id, user_id\) do update set role = 'owner'/);
  assert.match(migration, /Every resource keeps a placement in its original owner's private workspace/);
});

test("pending shares activate only after approval and only for live resources", () => {
  const moderation = functionSql("moderate_account");
  assert.match(moderation, /target_profile\.account_status/);
  assert.match(moderation, /p\.deleted_at is null/);
  assert.match(moderation, /rs\.revoked_at is null/);
  assert.match(moderation, /accepted_by = target_user_id, accepted_at = now\(\)/);
});

test("direct sharing mounts, revoke unmounts, and a revoked share can be shared again", () => {
  const share = functionSql("share_resource");
  assert.match(share, /insert into public\.resource_shares/);
  assert.match(share, /insert into public\.workspace_items/);
  assert.match(share, /alreadyShared/);
  assert.match(migration, /resource_shares_one_active_idx[\s\S]*where revoked_at is null/);
  assert.match(functionSql("revoke_resource_share"), /revoked_at = now\(\)/);
  assert.match(functionSql("revoke_resource_share"), /delete from public\.workspace_items/);
});

test("folder hierarchy and workspace placement remain separate and cycle-safe", () => {
  assert.match(migration, /create table if not exists public\.workspace_items/);
  assert.match(migration, /create table if not exists public\.folder_items/);
  assert.match(functionSql("move_workspace_item"), /workspace placement cycle/);
  assert.match(functionSql("get_workspace_tree"), /'workspace'::text as relation/);
  assert.match(functionSql("get_workspace_tree"), /'folder'::text/);
  assert.match(sidebar, /tree_relation === "folder"/);
  assert.match(sidebar, /공유 구조로 이동/);
});

test("owner trash hides resources without deleting shares and restore revives access", () => {
  const trash = functionSql("trash_resource");
  const restore = functionSql("restore_resource");
  assert.match(trash, /deleted_at = now\(\), purge_after = now\(\) \+ interval '30 days'/);
  assert.doesNotMatch(trash, /delete from public\.resource_shares/);
  assert.match(trash, /touch_resource_audience/);
  assert.match(restore, /deleted_at = null, purge_after = null/);
  assert.match(functionSql("touch_resource_audience"), /update public\.resource_shares/);
  assert.match(functionSql("touch_resource_audience"), /update public\.pages/);
  assert.match(functionSql("permanently_delete_resource"), /original_owner_id = auth\.uid\(\)/);
  assert.match(functionSql("purge_expired_resources"), /auth\.role\(\).*service_role/);
});

test("revoked editors fail at save time while optimistic concurrency remains intact", () => {
  for (const fn of ["update_log_entry_content", "update_log_entry_document_v2"]) {
    const sql = functionSql(fn);
    assert.match(sql, /can_edit_resource\(target_page_id, auth\.uid\(\)\)/);
    assert.match(sql, /expected_updated_at/);
    assert.match(sql, /errcode = '40001'/);
  }
});

test("publication remains token-scoped and owner-managed under resource permissions", () => {
  assert.match(publicationRoute, /context\.isOriginalOwner/);
  assert.match(migration, /public\.can_manage_resource_shares\(page_id, auth\.uid\(\)\)/);
  assert.match(schema, /publications_token_format/);
});

test("bootstrap schema contains the complete additive resource migration", () => {
  const normalizedSchema = schema.replace(/\r\n/g, "\n");
  const normalizedMigration = migration.replace(/\r\n/g, "\n").trim();
  assert.ok(normalizedSchema.includes(normalizedMigration), "schema.sql must bootstrap the same final model as the migration");
});

test("already-applied WIP databases receive an additive hardening migration", () => {
  assert.match(hardeningMigration, /alter table public\.resource_shares add column if not exists updated_at/);
  assert.match(hardeningMigration, /drop function if exists public\.get_workspace_tree\(uuid\)/);
  assert.match(hardeningMigration, /create or replace function public\.insert_folder_item/);
  assert.match(hardeningMigration, /grant execute on function public\.can_view_resource\(uuid, uuid\) to authenticated/);
  assert.doesNotMatch(hardeningMigration, /create table if not exists public\.(workspace_items|folder_items|resource_shares)/);
});

test("authentication abuse protection keeps four-character compatibility without reversible storage", () => {
  assert.match(loginRoute, /enforceRateLimit/);
  assert.match(signupRoute, /enforceRateLimit/);
  assert.match(passwordRoute, /currentPassword/);
  assert.match(passwordRoute, /signInWithPassword/);
  assert.match(setupRoute, /SETUP_SECRET/);
  assert.match(setupRoute, /timingSafeEqual/);
  assert.match(rateLimitHelper, /createHmac\("sha256"/);
  assert.doesNotMatch(rateLimitHelper, /createCipher|decrypt|encrypt/);
});

test("rate limit state is service-role only and stores no raw address", () => {
  assert.match(securityMigration, /create table if not exists public\.security_rate_limits/);
  assert.match(securityMigration, /revoke all on table public\.security_rate_limits from public, anon, authenticated/);
  assert.match(securityMigration, /auth\.role\(\).*service_role/);
  assert.match(securityMigration, /pg_advisory_xact_lock/);
  assert.match(securityMigration, /key_hash ~ '\^\[a-f0-9\]\{64\}\$'/);
  assert.doesNotMatch(securityMigration, /ip_address|user_agent/);
  assert.match(securityFixMigration, /declare rate_now timestamptz := clock_timestamp\(\)/);
  assert.doesNotMatch(securityFixMigration, /declare current_time/);
  assert.match(schema, /-- 202608280005_security_hardening\.sql[\s\S]*create table if not exists public\.security_rate_limits/);
});

test("browser security boundaries reject cross-site writes and emit hardened headers", () => {
  assert.match(proxy, /sec-fetch-site/);
  assert.match(proxy, /origin !== request\.nextUrl\.origin/);
  for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Permissions-Policy", "Strict-Transport-Security"]) {
    assert.match(nextConfig, new RegExp(header));
  }
});

test("drag movement preserves private placement and shared-folder hierarchy boundaries", () => {
  assert.match(sidebar, /draggable/);
  assert.match(sidebar, /TreeInteractionContext/);
  assert.match(sidebar, /\/api\/resources\/move/);
  assert.match(bulkMoveMigration, /source_folder_id/);
  assert.match(bulkMoveMigration, /public\.remove_folder_item/);
  assert.match(bulkMoveMigration, /public\.move_workspace_item/);
});
