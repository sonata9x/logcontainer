import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const memberRoute = readFileSync(new URL("../app/api/members/route.ts", import.meta.url), "utf8");

test("new users can only join workspaces through server-created pending invitations", () => {
  assert.match(schema, /from public\.workspace_invitations invitation/);
  assert.match(schema, /invitation\.email = lower\(new\.email\)/);
  assert.doesNotMatch(schema, /raw_user_meta_data\s*->>\s*'invited_workspace_id'/);
  assert.doesNotMatch(memberRoute, /invited_workspace_id/);
});

test("the invite API records a pending invitation before sending the auth invite", () => {
  const pendingIndex = memberRoute.indexOf('.from("workspace_invitations").upsert');
  const authInviteIndex = memberRoute.indexOf("inviteUserByEmail");
  assert.ok(pendingIndex >= 0);
  assert.ok(authInviteIndex > pendingIndex);
});

test("log entry writes are limited to audited security-definer functions", () => {
  assert.doesNotMatch(schema, /create policy "members can manage entries"/);
  assert.match(schema, /grant execute on function public\.update_log_entry_content/);
  assert.match(schema, /grant execute on function public\.set_log_entry_deleted/);
  assert.match(schema, /grant execute on function public\.create_log_entry/);
});
