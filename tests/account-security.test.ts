import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRecoverySecret, recoverySecretHash, validRecoverySecret, validAccountPassword, runAccountPasswordUpdate, verifyAccountPassword } from "../lib/account-security";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/202609180003_account_security.sql");
const ADMIN = "00000000-0000-0000-0000-000000000001";
const USER = "00000000-0000-0000-0000-000000000002";
const OTHER = "00000000-0000-0000-0000-000000000003";
const OLD_SESSION = "00000000-0000-0000-0000-000000000011";
const NEW_SESSION = "00000000-0000-0000-0000-000000000012";

test("recovery secrets are high-entropy bearer secrets, persisted only as domain-separated hashes", () => {
  const secrets = new Set(Array.from({ length: 100 }, () => createRecoverySecret()));
  assert.equal(secrets.size, 100);
  for (const secret of secrets) { assert.equal(secret.length, 43); assert.ok(validRecoverySecret(secret)); assert.match(recoverySecretHash(secret), /^[a-f0-9]{64}$/); assert.notEqual(recoverySecretHash(secret), secret); }
  assert.equal(validRecoverySecret("short"), false); assert.equal(validRecoverySecret(null), false);
  assert.equal(validAccountPassword("1234"), true); assert.equal(validAccountPassword("123"), false); assert.equal(validAccountPassword("x".repeat(201)), false);
});

test("account security migration executes against isolated PostgreSQL and preserves permission boundaries", async (t) => {
  const db = new PGlite();
  const actor = async (id: string, role = "authenticated", session = OLD_SESSION) => {
    await db.query<Record<string, unknown>>("select set_config('test.actor',$1,false),set_config('test.role',$2,false),set_config('test.session',$3,false)", [id, role, session]);
  };
  const service = () => actor("", "service_role");
  const issue = async (secret: string, kind = "link", user = USER, issuer = kind === "backup" ? USER : ADMIN) => {
    await service(); return (await db.query<{ result: { id: string; expiresAt: string | null } }>("select issue_account_recovery($1,$2,$3,$4) result", [user, issuer, recoverySecretHash(secret), kind])).rows[0].result;
  };
  const claim = async (secret: string) => {
    await service(); return (await db.query<{ result: { userId: string; operationId: string; recovery: boolean } }>("select begin_account_password_update(null,$1) result", [recoverySecretHash(secret)])).rows[0].result;
  };
  const finish = async (operation: { userId: string; operationId: string; recovery: boolean }, success = true) => {
    await service(); await db.query<Record<string, unknown>>("select finish_account_password_update($1,$2,$3,$4)", [operation.userId, operation.operationId, success, operation.recovery]);
  };
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select current_setting('test.role',true) $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('session_id',current_setting('test.session',true),'iat',extract(epoch from now())) $$;
      create table auth.sessions(id uuid primary key,user_id uuid,created_at timestamptz);
      create table profiles(id uuid primary key,username text not null unique,display_name text,account_status text,is_site_admin boolean,approved_at timestamptz,approved_by uuid,created_at timestamptz default now(),updated_at timestamptz default now());
      create table workspaces(id uuid default gen_random_uuid(),name text default '개인',owner_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());
      create function is_account_approved(target_user_id uuid default auth.uid()) returns boolean language sql stable security definer as $$ select exists(select 1 from profiles where id=target_user_id and account_status='approved') $$;
      create function is_site_admin(target_user_id uuid default auth.uid()) returns boolean language sql stable security definer as $$ select is_account_approved(target_user_id) and exists(select 1 from profiles where id=target_user_id and is_site_admin) $$;
      create table pending_resource_shares(id uuid default gen_random_uuid(),username text,accepted_at timestamptz,revoked_at timestamptz);
      create table resource_shares(user_id uuid references profiles(id),resource_id uuid);
      create table private_data(user_id uuid,content text);
      alter table private_data enable row level security;
      grant select on private_data to authenticated;
      create policy own_approved_data on private_data for select to authenticated using(user_id=auth.uid() and is_account_approved(auth.uid()));
      insert into private_data values('${USER}','private fixture');
      insert into profiles(id,username,display_name,account_status,is_site_admin) values ('${ADMIN}','admin','관리자','approved',true),('${USER}','member','회원','approved',false),('${OTHER}','other','다른 회원','approved',false);
      insert into workspaces(owner_id) values('${ADMIN}'),('${USER}'),('${OTHER}');
      insert into auth.sessions values ('${OLD_SESSION}','${USER}',now()-interval '2 days');
      insert into pending_resource_shares(username,accepted_at) values ('member',null),('member',now()),('elsewhere',null);
      insert into resource_shares values ('${USER}','00000000-0000-0000-0000-000000000021');
    `);
    await service(); await db.exec(migration); await db.exec(migration);

    await t.test("ID changes keep UUID shares and revoke only old unaccepted username invites", async () => {
      await db.query<Record<string, unknown>>("select change_account_username($1,'new-member')", [USER]);
      assert.equal((await db.query<{ username: string }>("select username from profiles where id=$1", [USER])).rows[0].username, "new-member");
      assert.equal((await db.query<{ count: number }>("select count(*)::int count from resource_shares where user_id=$1", [USER])).rows[0].count, 1);
      assert.equal((await db.query<{ count: number }>("select count(*)::int count from pending_resource_shares where revoked_at is not null")).rows[0].count, 1);
      await assert.rejects(db.query<Record<string, unknown>>("select change_account_username($1,'member')", [USER]), /reserved/);
      await assert.rejects(db.query<Record<string, unknown>>("select change_account_username($1,'other')", [USER]), /unique|duplicate/);
      await assert.rejects(db.query<Record<string, unknown>>("insert into profiles(id,username,display_name,account_status,is_site_admin) values(gen_random_uuid(),'member','再登録','pending',false)"), /reserved/);
      await assert.rejects(db.query<Record<string, unknown>>("select change_account_username($1,'INVALID')", [USER]), /invalid username/);
    });

    await t.test("only service-role verified operations can write credentials or issue secrets", async () => {
      await actor(USER);
      await assert.rejects(db.query<Record<string, unknown>>("select change_account_username($1,'attack')", [OTHER]), /permission denied/);
      await assert.rejects(db.query<Record<string, unknown>>("select issue_account_recovery($1,$2,$3,'link')", [USER, USER, "a".repeat(64)]), /permission denied/);
      await service();
      await assert.rejects(db.query<Record<string, unknown>>("select issue_account_recovery($1,$2,$3,'link')", [OTHER, USER, "a".repeat(64)]), /permission denied/);
      await assert.rejects(db.query<Record<string, unknown>>("select issue_account_recovery($1,$2,$3,'backup')", [OTHER, USER, "a".repeat(64)]), /permission denied/);
      await assert.rejects(db.query<Record<string, unknown>>("select issue_account_recovery($1,$2,$3,'link')", [ADMIN, ADMIN, "a".repeat(64)]), /backup/);
      await db.exec("grant usage on schema auth to authenticated; grant update(username) on profiles to authenticated");
      await actor(USER); await db.exec("set role authenticated");
      try {
        await assert.rejects(db.query<Record<string, unknown>>("select * from account_recovery_tokens"), /permission denied/);
        await assert.rejects(db.query<Record<string, unknown>>("select * from account_security_state"), /permission denied/);
        await assert.rejects(db.query<Record<string, unknown>>("select * from account_username_history"), /permission denied/);
        await assert.rejects(db.query<Record<string, unknown>>("update profiles set username='attack' where id=$1", [USER]), /permission denied|server verified/);
        await assert.rejects(db.query<Record<string, unknown>>("select begin_account_password_update($1,null)", [USER]), /permission denied/);
      } finally { await db.exec("reset role"); }
    });

    await t.test("issuing a 30-minute link does not lock the account and reissue revokes the old link", async () => {
      const old = await issue("old-link"); const current = await issue("current-link");
      assert.ok(current.expiresAt);
      const ttl = (await db.query<{ ttl: number }>("select extract(epoch from expires_at-created_at)::int ttl from account_recovery_tokens where id=$1", [current.id])).rows[0].ttl;
      assert.equal(ttl, 1800);
      assert.ok((await db.query<Record<string, unknown>>("select revoked_at from account_recovery_tokens where id=$1", [old.id])).rows[0].revoked_at);
      await actor(USER); assert.equal((await db.query<Record<string, unknown>>("select account_session_valid() valid")).rows[0].valid, true);
      await assert.rejects(claim("old-link"), /invalid recovery/);
    });

    await t.test("expired, cancelled, missing and disabled-account tokens cannot start a reset", async () => {
      const expired = await issue("expired"); await db.query<Record<string, unknown>>("update account_recovery_tokens set expires_at=now()-interval '1 second' where id=$1", [expired.id]);
      await assert.rejects(claim("expired"), /invalid recovery/);
      const cancelled = await issue("cancelled"); await db.query<Record<string, unknown>>("select revoke_account_recovery($1,$2)", [cancelled.id, ADMIN]);
      await assert.rejects(claim("cancelled"), /invalid recovery/);
      await assert.rejects(claim("not-found"), /invalid recovery/);
      await issue("disabled"); await db.query<Record<string, unknown>>("update profiles set account_status='disabled' where id=$1", [USER]);
      await assert.rejects(claim("disabled"), /invalid recovery/);
      await db.query<Record<string, unknown>>("update profiles set account_status='approved' where id=$1", [USER]);
    });

    await t.test("claim is single-use and serializes ID/password/recovery changes; refreshing old JWT cannot revive access", async () => {
      await issue("active"); const operation = await claim("active");
      await assert.rejects(claim("active"), /pending|invalid recovery/);
      await assert.rejects(issue("race"), /pending/);
      await assert.rejects(db.query<Record<string, unknown>>("select change_account_username($1,'race-id')", [USER]), /pending/);
      await actor(USER);
      assert.equal((await db.query<Record<string, unknown>>("select account_session_valid() valid")).rows[0].valid, false);
      assert.equal((await db.query<Record<string, unknown>>("select get_personal_session_context() context")).rows[0].context, null);
      await db.exec("set role authenticated");
      try { assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from private_data")).rows[0].count, 0); } finally { await db.exec("reset role"); }
      assert.equal((await db.query<Record<string, unknown>>("select is_account_approved($1) approved", [USER])).rows[0].approved, false);
      assert.equal((await db.query<Record<string, unknown>>("select is_account_approved($1) approved", [OTHER])).rows[0].approved, true);
      await finish(operation);
      await actor(USER); assert.equal((await db.query<Record<string, unknown>>("select account_session_valid() valid")).rows[0].valid, false);
      await service(); await assert.rejects(claim("active"), /invalid recovery/);
      await db.query<Record<string, unknown>>("insert into auth.sessions values($1,$2,clock_timestamp())", [NEW_SESSION, USER]);
      await actor(USER, "authenticated", NEW_SESSION);
      assert.equal((await db.query<Record<string, unknown>>("select account_session_valid() valid")).rows[0].valid, true);
      assert.ok((await db.query<Record<string, unknown>>("select get_personal_session_context() context")).rows[0].context);
      await db.exec("set role authenticated");
      try { assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from private_data")).rows[0].count, 1); } finally { await db.exec("reset role"); }
      assert.equal((await db.query<Record<string, unknown>>("select is_account_approved($1) approved", [USER])).rows[0].approved, true);
      await actor(USER, "authenticated", "malformed"); assert.equal((await db.query<Record<string, unknown>>("select account_session_valid() valid")).rows[0].valid, false);
    });

    await t.test("backup code replacement, successful reset and failed reset never reopen consumed tokens", async () => {
      await issue("backup-old", "backup"); await issue("backup-new", "backup");
      await assert.rejects(claim("backup-old"), /invalid recovery/);
      await issue("outstanding-link"); const operation = await claim("backup-new");
      await finish(operation, false);
      await assert.rejects(claim("backup-new"), /invalid recovery|pending/);
      await assert.rejects(claim("outstanding-link"), /invalid recovery|pending/);
      assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from account_security_events where action='password_update_failed'")).rows[0].count, 1);
      await assert.rejects(issue("too-early-retry"), /pending/);
      await db.query<Record<string, unknown>>("update account_security_state set operation_started_at=now()-interval '16 minutes' where user_id=$1", [USER]);
      await db.query<Record<string, unknown>>("select abort_account_password_update($1,$2)", [USER, ADMIN]);
      await assert.rejects(claim("backup-new"), /invalid recovery/);
      await assert.rejects(claim("outstanding-link"), /invalid recovery/);
      await issue("retry"); await finish(await claim("retry"));
      assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from account_security_events where action='password_reset'")).rows[0].count, 2);
    });

    await t.test("ordinary password update uses the same durable session invalidation and audit path", async () => {
      await service();
      const operation = (await db.query<{ result: { userId: string; operationId: string; recovery: boolean } }>("select begin_account_password_update($1,null) result", [USER])).rows[0].result;
      assert.equal(operation.recovery, false);
      await assert.rejects(db.query<Record<string, unknown>>("select finish_account_password_update($1,gen_random_uuid(),true,false)", [USER]), /mismatch/);
      await finish(operation);
      assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from account_security_events where action='password_changed' and actor_id=$1", [USER])).rows[0].count, 1);
    });

    await t.test("a crash remains fail-closed and only a verified admin can explicitly abort after 15 minutes", async () => {
      await issue("crash"); await claim("crash");
      await assert.rejects(db.query<Record<string, unknown>>("select abort_account_password_update($1,$2)", [USER, ADMIN]), /still active/);
      await db.query<Record<string, unknown>>("update account_security_state set operation_started_at=now()-interval '16 minutes' where user_id=$1", [USER]);
      await assert.rejects(db.query<Record<string, unknown>>("select abort_account_password_update($1,$2)", [USER, USER]), /permission denied/);
      await db.query<Record<string, unknown>>("select abort_account_password_update($1,$2)", [USER, ADMIN]);
      await assert.rejects(claim("crash"), /invalid recovery/);
      assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from account_security_events where action='operation_aborted'")).rows[0].count, 2);
    });

    await t.test("overview permits only self/site admin and never returns hashes or tokens", async () => {
      await service(); await db.query<Record<string, unknown>>("update auth.sessions set created_at=clock_timestamp() where id=$1", [NEW_SESSION]);
      await actor(USER, "authenticated", NEW_SESSION);
      await assert.rejects(db.query<Record<string, unknown>>("select account_security_overview($1)", [OTHER]), /permission denied/);
      const own = (await db.query<Record<string, unknown>>("select account_security_overview($1) overview", [USER])).rows[0].overview;
      assert.equal((own as { username: string }).username, "new-member");
      assert.doesNotMatch(JSON.stringify(own), /token_hash|sessions_valid_after|operationId|secret|active|backup-new/);
      await actor(ADMIN); const all = (await db.query<Record<string, unknown>>("select account_security_overview($1) overview", [USER])).rows[0].overview;
      assert.ok((all as { events: unknown[] }).events.length > 0);
    });
    await t.test("90-day cleanup removes old events/expired tokens but retains live backup and ID reservations", async () => {
      await service(); await issue("live-backup", "backup");
      await db.query<Record<string, unknown>>("insert into account_security_events(user_id,action,created_at) values($1,'login_failed',now()-interval '91 days')", [USER]);
      await db.query<Record<string, unknown>>("insert into account_recovery_tokens(user_id,token_hash,kind,issued_by,created_at,expires_at) values($1,$2,'link',$3,now()-interval '91 days',now()-interval '90 days 1 second')", [USER, recoverySecretHash("old-cleanup"), ADMIN]);
      const purged = (await db.query<Record<string, unknown>>("select purge_account_security_records() removed")).rows[0].removed;
      assert.equal(purged, 1);
      assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from account_recovery_tokens where token_hash=$1", [recoverySecretHash("old-cleanup")])).rows[0].count, 0);
      assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from account_recovery_tokens where token_hash=$1", [recoverySecretHash("live-backup")])).rows[0].count, 1);
      assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from account_username_history where username='member'")).rows[0].count, 1);
      await actor(USER); await assert.rejects(db.query<Record<string, unknown>>("select purge_account_security_records()"), /permission denied/);
    });
    await t.test("operator script unlocks only a stale administrator operation, keeps consumed code invalid and records the action", async () => {
      await issue("admin-backup", "backup", ADMIN, ADMIN); await claim("admin-backup");
      const unlock = read("supabase/maintenance/unlock_site_admin_password_operation.sql");
      await assert.rejects(db.exec(unlock), /no stale/); await db.exec("rollback");
      await db.query<Record<string, unknown>>("update account_security_state set operation_started_at=now()-interval '16 minutes' where user_id=$1", [ADMIN]);
      await db.exec(unlock);
      assert.equal((await db.query<Record<string, unknown>>("select pending_operation from account_security_state where user_id=$1", [ADMIN])).rows[0].pending_operation, null);
      await assert.rejects(claim("admin-backup"), /invalid recovery/);
      assert.equal((await db.query<Record<string, unknown>>("select count(*)::int count from account_security_events where user_id=$1 and action='operation_aborted'", [ADMIN])).rows[0].count, 1);
    });
  } finally { await db.close(); }
});

test("real Auth SDK reauthentication is isolated, derives passwords and verifies returned user identity", async () => {
  const oldFetch = globalThis.fetch;
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
  const previous = names.map((name) => process.env[name]);
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth-test.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  let wrongPassword = false; let returnedId = USER;
  const calls: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input); const body = String(init?.body ?? ""); calls.push({ url, body });
    if (url.includes("/admin/users/")) return Response.json({ id: USER, email: "internal@auth.logcontainer.local" });
    if (url.includes("/token?")) {
      if (wrongPassword) return Response.json({ code: "invalid_credentials", msg: "Invalid login credentials" }, { status: 400 });
      return Response.json({ access_token: "test-access", refresh_token: "test-refresh", expires_in: 3600, token_type: "bearer", user: { id: returnedId, email: "internal@auth.logcontainer.local" } });
    }
    if (url.includes("/logout?scope=local")) return new Response(null, { status: 204 });
    throw new Error("Unexpected Auth test request");
  };
  try {
    assert.equal(await verifyAccountPassword(USER, "1234"), true);
    assert.ok(calls.some((call) => call.url.includes("logout?scope=local")));
    assert.doesNotMatch(calls.find((call) => call.url.includes("/token?"))?.body ?? "", /"password":"1234"/);
    wrongPassword = true; assert.equal(await verifyAccountPassword(USER, "bad!"), false);
    wrongPassword = false; returnedId = OTHER; assert.equal(await verifyAccountPassword(USER, "1234"), false);
    assert.equal(await verifyAccountPassword(USER, "123"), false);
    returnedId = USER; assert.equal(await verifyAccountPassword(USER, "x".repeat(201)), true);
  } finally {
    globalThis.fetch = oldFetch;
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});

test("password orchestration finalizes successes and failures, never reports success after audit failure", async () => {
  for (const scenario of ["success", "auth-error", "network-error", "finish-error", "claim-error"]) {
    const calls: Array<{ name: string; params: unknown }> = [];
    const client = { rpc: async (name: string, params: unknown) => { calls.push({ name, params }); return name.startsWith("begin") ? { data: { userId: USER, operationId: OLD_SESSION, recovery: true }, error: scenario === "claim-error" ? {} : null } : { error: scenario === "finish-error" ? {} : null }; }, auth: { admin: { updateUserById: async (_id: string, params: unknown) => { calls.push({ name: "auth", params }); if (scenario === "network-error") throw new Error("network down"); return { error: scenario === "auth-error" ? {} : null }; } } } } as unknown as SupabaseClient;
    const run = runAccountPasswordUpdate(client, "1234", { recovery_hash: "a".repeat(64) });
    if (scenario === "success") await run; else await assert.rejects(run);
    assert.deepEqual(calls.map((call) => call.name), scenario === "claim-error" ? ["begin_account_password_update"] : ["begin_account_password_update", "auth", "finish_account_password_update"]);
    assert.doesNotMatch(JSON.stringify(calls), /"password":"1234"/);
    if (scenario !== "claim-error") assert.equal((calls[2].params as { succeeded: boolean }).succeeded, scenario === "success" || scenario === "finish-error");
  }
});

test("account routes and UI keep server reauthentication, request limiting and fragment-token protection", () => {
  for (const path of ["app/api/account/username/route.ts", "app/api/account/password/route.ts", "app/api/account/security/route.ts", "app/api/admin/accounts/[userId]/security/route.ts"]) {
    const source = read(path); assert.match(source, /verifyAccountPassword/); assert.match(source, /enforceRateLimit/); assert.doesNotMatch(source, /console\.(log|error)\([^\n]*(body|token|password)/);
  }
  assert.match(read("app/api/account/recovery/route.ts"), /validRecoverySecret/);
  assert.match(read("app/api/admin/accounts/[userId]/security/route.ts"), /\/recover#token=/);
  assert.match(read("components/AccountRecoveryForm.tsx"), /history.replaceState/);
  assert.match(read("components/AccountRecoveryForm.tsx"), /setToken\(""\)/);
  assert.match(read("app/recover/page.tsx"), /referrer: "no-referrer"/);
  assert.match(read("components/WorkspaceSidebar.tsx"), /settingsTab === "account" && <AccountSecurityPanel/);
  assert.match(read("lib/api-auth.ts"), /sessionValid !== true/);
  assert.match(read("app/api/login/route.ts"), /account_session_valid/);
});
