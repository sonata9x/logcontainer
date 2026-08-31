import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/202608280015_privacy_security_polish.sql", import.meta.url), "utf8");
const importRoute = readFileSync(new URL("../app/api/pages/[id]/import/route.ts", import.meta.url), "utf8");
const restoreRoute = readFileSync(new URL("../app/api/pages/[id]/restore-original/route.ts", import.meta.url), "utf8");
const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const nextConfig = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const loading = readFileSync(new URL("../app/workspace/pages/[id]/loading.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(new URL("../components/WorkspaceSidebar.tsx", import.meta.url), "utf8");
const modalHook = readFileSync(new URL("../lib/use-escape-close.ts", import.meta.url), "utf8");
const purgeRoute = readFileSync(new URL("../app/api/internal/purge/route.ts", import.meta.url), "utf8");
const logEditor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");

test("HTML reimport is owner-only in UI API and database RPC", () => {
  assert.match(importRoute, /context\.canReimport/);
  assert.match(migration, /replace_log_entries_v3[\s\S]*can_reimport_resource\(target_page_id, auth\.uid\(\)\)/);
  assert.doesNotMatch(migration.slice(migration.indexOf("replace_log_entries_v3")), /can_edit_resource\(target_page_id/);
});

test("log import requires an explicit platform selection", () => {
  assert.match(logEditor, /플랫폼을 선택해주세요/);
  assert.doesNotMatch(logEditor, /<option value="auto">자동 감지<\/option>/);
  assert.match(importRoute, /업로드할 로그의 플랫폼을 선택해주세요/);
  assert.doesNotMatch(importRoute, /body\.platform : "auto"/);
});

test("full restore preserves canonical text and emits a lightweight refresh", () => {
  assert.match(restoreRoute, /projectDocumentText/);
  assert.match(restoreRoute, /baselineContents/);
  assert.match(restoreRoute, /restore_log_original_v2/);
  assert.match(migration, /baseline_contents->>entry\.id::text/);
  assert.match(migration, /original_content = coalesce/);
  assert.match(migration, /values \(target_log\.id, null, 'log_replaced'\)/);
});

test("privacy headers and global security headers remain hardened", () => {
  assert.match(proxy, /\/share\/:path\*/);
  assert.match(proxy, /noindex, nofollow, noarchive/);
  assert.match(proxy, /Referrer-Policy", "no-referrer/);
  assert.match(proxy, /sec-fetch-site/);
  for (const header of ["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Permissions-Policy", "Cross-Origin-Opener-Policy", "Strict-Transport-Security"]) assert.match(nextConfig, new RegExp(header));
});

test("loading and modal interactions remain visible and interruptible", () => {
  assert.match(loading, /로그 불러오는 중…/);
  assert.match(modalHook, /event\.key === "Escape"/);
  assert.match(sidebar, /useEscapeClose\(onClose, pending\)/);
  assert.match(sidebar, /document\.title = currentWorkspaceName/);
});

test("expired external sessions join the existing protected purge job", () => {
  assert.match(migration, /purge_expired_external_sessions/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(purgeRoute, /purge_expired_external_sessions/);
  assert.match(purgeRoute, /CRON_SECRET/);
});
