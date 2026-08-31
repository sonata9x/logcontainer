import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/202608280013_publication_privacy.sql", import.meta.url), "utf8");
const manageRoute = readFileSync(new URL("../app/api/pages/[id]/publication/route.ts", import.meta.url), "utf8");
const passwordRoute = readFileSync(new URL("../app/api/publications/[token]/password/route.ts", import.meta.url), "utf8");
const entriesRoute = readFileSync(new URL("../app/api/publications/[token]/entries/route.ts", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/p/[token]/page.tsx", import.meta.url), "utf8");
const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
const managementMigration = readFileSync(new URL("../supabase/migrations/202608310003_publication_password_management.sql", import.meta.url), "utf8");

test("admin and owner can manage public or password publications", () => {
  assert.match(manageRoute, /context\?\.canPublish/);
  assert.match(manageRoute, /visibility === "password"/);
  assert.match(manageRoute, /hashPassword/);
  assert.match(manageRoute, /verifyPassword\(currentPassword, existing\.password_hash/);
  assert.match(manageRoute, /hasExistingPassword && !nextPassword/);
  assert.match(editor, /현재 비밀번호/);
  assert.match(editor, /새 비밀번호 \(변경하지 않으면 비워두기\)/);
  assert.doesNotMatch(editor, /비밀번호 확인/);
  assert.match(migration, /can_publish_resource\(target_page_id, auth\.uid\(\)\)/);
  assert.match(migration, /visibility in \('public', 'password'\)/);
});

test("publication password hashes cannot be selected directly by authenticated clients", () => {
  assert.match(managementMigration, /revoke all on table public\.publications from public, anon, authenticated/);
  assert.match(manageRoute, /createSupabaseAdminClient/);
  assert.doesNotMatch(manageRoute, /password_hash.*NextResponse\.json/);
});

test("password sessions are hashed versioned and invalidated on changes", () => {
  assert.match(migration, /publication_sessions_token_hash_check/);
  assert.match(migration, /password_version = public\.publications\.password_version \+ 1/);
  assert.match(migration, /publication_sessions set revoked_at = now\(\)/);
  assert.match(passwordRoute, /verifyPassword/);
  assert.match(passwordRoute, /hashOpaqueToken\(sessionToken\)/);
  assert.match(passwordRoute, /scope: "publication-password"/);
  assert.match(passwordRoute, /httpOnly: true/);
});

test("page HTML and entries API share the same publication access gate", () => {
  assert.match(page, /getPublicationAccess/);
  assert.match(entriesRoute, /getPublicationAccess/);
  assert.match(entriesRoute, /if \(!access\?\.authorized\)/);
  assert.match(page, /PublicationPasswordGate/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /revoke execute on function public\.get_published_log[\s\S]*from public, anon, authenticated/);
});

test("password publications never use a shared cached data path", () => {
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.doesNotMatch(page, /getCachedPublishedLog|unstable_cache|\bcache\(/);
  assert.match(entriesRoute, /"Cache-Control": "no-store"/);
});
