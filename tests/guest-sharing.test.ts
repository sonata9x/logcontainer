import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/202608280011_guest_page_sharing.sql", import.meta.url), "utf8");
const credentials = readFileSync(new URL("../lib/secure-credentials.ts", import.meta.url), "utf8");
const guestAuth = readFileSync(new URL("../lib/guest-auth.ts", import.meta.url), "utf8");
const authRoute = readFileSync(new URL("../app/api/share/[token]/auth/route.ts", import.meta.url), "utf8");
const changesRoute = readFileSync(new URL("../app/api/share/[token]/changes/route.ts", import.meta.url), "utf8");
const entryRoute = readFileSync(new URL("../app/api/share/[token]/entries/[entryId]/route.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

test("guest storage keeps only password and opaque token hashes", () => {
  assert.match(migration, /page_share_links_token_hash_check/);
  assert.match(migration, /guest_sessions_token_hash_check/);
  assert.match(migration, /password_hash like 'scrypt\$%'/);
  assert.match(credentials, /nodeScrypt/);
  assert.match(credentials, /randomBytes\(16\)/);
  assert.match(credentials, /timingSafeEqual/);
  assert.match(credentials, /createHash\("sha256"\)/);
  assert.doesNotMatch(migration, /\btoken text\b|\bpassword text\b/);
});

test("guest tables are service-only and links revoke active sessions", () => {
  for (const table of ["page_share_links", "guest_participants", "guest_sessions"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`));
  }
  assert.match(migration, /next_token_hash is not null or next_is_active = false[\s\S]*guest_sessions/);
  assert.match(migration, /guest_participants_active_nickname_idx[\s\S]*where revoked_at is null/);
});

test("guest authentication reuses the DB-backed limiter and an opaque HttpOnly cookie", () => {
  assert.match(authRoute, /scope: "guest-page-auth"/);
  assert.match(authRoute, /verifyPassword/);
  assert.match(authRoute, /GUEST_SESSION_COOKIE/);
  assert.match(authRoute, /httpOnly: true/);
  assert.match(authRoute, /sameSite: "lax"/);
  assert.match(guestAuth, /hashOpaqueToken\(sessionToken\)/);
  assert.doesNotMatch(guestAuth, /fingerprint|user-agent/i);
});

test("guest editor writes preserve validation concurrency COW and attribution", () => {
  assert.match(entryRoute, /validateLogEntryDocument/);
  assert.match(entryRoute, /sanitizeRichStyle/);
  assert.match(entryRoute, /expected_updated_at/);
  assert.match(migration, /original_document = coalesce\(original_document, document\)/);
  assert.match(migration, /guest_participant_id/);
  assert.match(migration, /editor_id, guest_participant_id/);
  assert.match(entryRoute, /if \(!context\.canEdit\)/);
});

test("guest sync is event-cursor scoped and private routes get privacy headers", () => {
  assert.match(changesRoute, /\.eq\("log_id", context\.log\.id\)/);
  assert.match(changesRoute, /\.gt\("id", after\)/);
  assert.match(changesRoute, /select\("id, entry_id, event_type, updated_at"\)/);
  assert.match(proxy, /pathname\.startsWith\("\/p\/"\) \|\| pathname\.startsWith\("\/share\/"\)/);
  assert.match(proxy, /noindex, nofollow, noarchive/);
  assert.match(proxy, /no-referrer/);
});
