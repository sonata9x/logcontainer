import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/202608280010_registered_resource_sharing.sql", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/resources/[id]/shares/route.ts", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../components/WorkspaceSidebar.tsx", import.meta.url), "utf8");

test("owner and admin role grants are constrained independently of UI", () => {
  assert.match(migration, /actor_role not in \('admin', 'owner'\)/);
  assert.match(migration, /actor_role = 'admin' and target_access_level = 'admin'/);
  assert.match(migration, /actor_role = 'admin' and \(current_access_level = 'admin' or next_access_level = 'admin'\)/);
  assert.match(migration, /actor_role = 'admin' and current_access_level = 'admin'/);
  assert.match(route, /context\.resourceRole !== "owner" && body\.accessLevel === "admin"/);
});

test("active and pending shares preserve viewer editor and admin roles", () => {
  assert.match(migration, /target_access_level not in \('viewer', 'editor', 'admin'\)/);
  assert.match(migration, /pending_resource_shares\(resource_id, username, access_level/);
  assert.match(migration, /select prs\.resource_id, target_user_id, prs\.access_level/);
  assert.match(migration, /prs\.access_level = 'admin'/);
  assert.match(migration, /target_state not in \('active', 'pending'\)/);
});

test("owner is projected and cannot be mutated as a share row", () => {
  assert.match(migration, /page\.original_owner_id/);
  assert.match(migration, /'owner'::text/);
  assert.match(migration, /null::uuid/);
  assert.match(migration, /true as is_owner/);
  assert.match(migration, /order by members\.is_owner desc, members\.created_at/);
  assert.match(sidebar, /share\.is_owner \? <span>\{ROLE_LABELS\.owner\}<\/span>/);
});

test("share dialog uses role selectors and hides role-ineligible actions", () => {
  assert.match(sidebar, /name="accessLevel"/);
  assert.match(sidebar, /page\.can_manage_shares/);
  assert.match(sidebar, /protectedAdmin/);
  assert.match(sidebar, /className="member-identity"/);
  assert.doesNotMatch(sidebar, /name="canInvite"/);
  assert.match(sidebar, /page\.can_edit && <button onClick=\{onRename\}/);
});
