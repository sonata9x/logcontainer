import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/202608270002_personal_resources.sql", import.meta.url), "utf8");
const loginRoute = readFileSync(new URL("../app/api/login/route.ts", import.meta.url), "utf8");
const signupRoute = readFileSync(new URL("../app/api/signup/route.ts", import.meta.url), "utf8");
const adminHelper = readFileSync(new URL("../lib/admin-auth.ts", import.meta.url), "utf8");
const memberRoute = readFileSync(new URL("../app/api/members/route.ts", import.meta.url), "utf8");

test("account approval is a database security boundary", () => {
  assert.match(migration, /account_status in \('pending', 'approved', 'rejected', 'disabled'\)/);
  assert.match(migration, /create or replace function public\.is_account_approved/);
  assert.match(migration, /if not public\.is_account_approved\(actor_id\)/);
  assert.match(loginRoute, /profile\.account_status !== "approved"/);
  assert.match(loginRoute, /관리자 승인 대기 중인 계정입니다/);
});

test("first account is admin and later signup stays pending without a session", () => {
  assert.match(migration, /case when first_account then 'approved' else 'pending' end/);
  assert.match(migration, /first_account,/);
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
  assert.match(adminHelper, /is_site_admin/);
  assert.match(migration, /original_owner_id uuid/);
  assert.doesNotMatch(migration.match(/create or replace function public\.can_view_resource[\s\S]*?\$\$;/)?.[0] ?? "", /is_site_admin/);
});

test("resource permissions centralize direct, inherited and invitation access", () => {
  for (const helper of ["is_original_resource_owner", "has_direct_resource_share", "has_inherited_resource_access", "can_view_resource", "can_edit_resource", "can_invite_resource", "can_manage_resource_shares", "can_delete_resource"]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${helper}`));
  }
  assert.match(migration, /with recursive ancestors/);
  assert.match(migration, /rs\.revoked_at is null and rs\.can_invite/);
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
});

test("collaborator removal revokes share while owner deletion uses 30-day trash", () => {
  assert.match(migration, /revocation_reason = 'self_remove'/);
  assert.match(migration, /purge_after = now\(\) \+ interval '30 days'/);
  assert.match(migration, /create or replace function public\.permanently_delete_resource/);
  assert.match(migration, /original_owner_id = auth\.uid\(\) and deleted_at is not null/);
});

test("legacy workspace member creation API is retired", () => {
  assert.match(memberRoute, /워크스페이스 멤버 기능은 종료되었습니다/);
  assert.doesNotMatch(memberRoute, /workspace_members.*insert|pending_accounts.*upsert/);
});
