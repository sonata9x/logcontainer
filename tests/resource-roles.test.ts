import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/202608280009_resource_roles.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const apiAuth = readFileSync(new URL("../lib/api-auth.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");

test("resource role migration preserves legacy invite meaning", () => {
  assert.match(migration, /access_level in \('viewer', 'editor', 'admin'\)/);
  assert.match(migration, /pending_resource_shares[\s\S]*add column if not exists access_level/);
  assert.match(migration, /update public\.resource_shares[\s\S]*when can_invite then 'admin' else 'editor'/);
  assert.match(migration, /update public\.pending_resource_shares[\s\S]*when can_invite then 'admin' else 'editor'/);
  assert.doesNotMatch(migration, /drop column[\s\S]*can_invite/i);
});

test("effective role uses the highest direct or inherited grant without transferring ownership", () => {
  assert.match(migration, /create or replace function public\.get_effective_resource_role/);
  assert.match(migration, /with recursive scope/);
  assert.match(migration, /scope\.depth = 0[\s\S]*then 'owner'/);
  assert.match(migration, /scope\.depth > 0[\s\S]*then 'admin'/);
  assert.match(migration, /join public\.resource_shares share[\s\S]*share\.revoked_at is null/);
  assert.match(migration, /order by public\.resource_role_rank\(resource_role\) desc/);
});

test("central permission helpers enforce the four-level matrix", () => {
  for (const helper of [
    "can_view_resource",
    "can_edit_resource",
    "can_manage_resource_shares",
    "can_manage_guest_link",
    "can_publish_resource",
    "can_reimport_resource",
    "can_restore_resource_original",
    "can_delete_resource"
  ]) assert.match(migration, new RegExp(`create or replace function public\\.${helper}`));
  assert.match(migration, /can_edit_resource[\s\S]*resource_role_rank[\s\S]*>= 2/);
  assert.match(migration, /can_manage_resource_shares[\s\S]*resource_role_rank[\s\S]*>= 3/);
  assert.match(migration, /can_reimport_resource[\s\S]*= 'owner'/);
  assert.match(migration, /can_delete_resource[\s\S]*= 'owner'/);
});

test("page payload exposes a compact role permission DTO", () => {
  for (const key of ["canView", "canEdit", "canManageShares", "canManageGuestLink", "canPublish", "canReimport", "canRestoreOriginal", "canTrashResource", "canSelfRemove"]) {
    assert.match(migration, new RegExp(`'${key}'`));
    assert.match(types, new RegExp(`${key}: boolean`));
  }
  assert.match(types, /ResourceRole = "viewer" \| "editor" \| "admin" \| "owner"/);
  assert.match(apiAuth, /permissions: ResourcePermissions/);
  assert.match(apiAuth, /resourceRole: permissions\.role/);
  assert.match(migration, /'permissions', permissions/);
});

test("bootstrap schema includes the additive role migration", () => {
  const marker = "-- 202608280009_resource_roles.sql";
  assert.ok(schema.includes(marker));
  assert.equal(
    schema.slice(schema.indexOf(marker) + marker.length).replace(/\r\n/g, "\n").trim(),
    migration.replace(/\r\n/g, "\n").trim()
  );
});
