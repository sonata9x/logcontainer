import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const memberRoute = readFileSync(new URL("../app/api/members/route.ts", import.meta.url), "utf8");

test("new users can only join workspaces through server-created pending accounts", () => {
  assert.match(schema, /from public\.pending_accounts invitation/);
  assert.match(schema, /invitation\.username = resolved_username/);
  assert.doesNotMatch(schema, /raw_user_meta_data\s*->>\s*'invited_workspace_id'/);
  assert.doesNotMatch(schema, /profiles[\s\S]*?email text/);
});

test("the member API records a pending account before creating the auth user", () => {
  const pendingIndex = memberRoute.indexOf('.from("pending_accounts").upsert');
  const createUserIndex = memberRoute.indexOf("admin.auth.admin.createUser");
  assert.ok(pendingIndex >= 0);
  assert.ok(createUserIndex > pendingIndex);
  assert.doesNotMatch(memberRoute, /inviteUserByEmail/);
});

test("log entry writes are limited to audited security-definer functions", () => {
  assert.doesNotMatch(schema, /create policy "members can manage entries"/);
  assert.match(schema, /grant execute on function public\.update_log_entry_content/);
  assert.match(schema, /grant execute on function public\.set_log_entry_deleted/);
  assert.match(schema, /grant execute on function public\.create_log_entry/);
});
