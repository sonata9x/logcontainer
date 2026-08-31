import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeHexColor } from "../lib/color";

const migration = readFileSync(new URL("../supabase/migrations/202608280014_user_preferences.sql", import.meta.url), "utf8");
const settingsRoute = readFileSync(new URL("../app/api/account/settings/route.ts", import.meta.url), "utf8");
const exportRoute = readFileSync(new URL("../app/api/pages/[id]/export/route.ts", import.meta.url), "utf8");
const guestExport = readFileSync(new URL("../app/api/share/[token]/export/route.ts", import.meta.url), "utf8");
const exportDialog = readFileSync(new URL("../components/ExportDialog.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/workspace/layout.tsx", import.meta.url), "utf8");
const guestLog = readFileSync(new URL("../components/GuestLog.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("personal preferences validate accent and remain user-scoped", () => {
  assert.match(migration, /accent_color ~ '\^#\[0-9A-Fa-f\]\{6\}\$'/);
  assert.match(migration, /user_id = auth\.uid\(\)/);
  assert.match(migration, /update_user_preferences/);
  assert.match(settingsRoute, /normalizeHexColor/);
  assert.match(settingsRoute, /parseCorrectionSettings/);
});

test("accent color accepts short and full HEX and normalizes to uppercase six digits", () => {
  assert.equal(normalizeHexColor("#abc"), "#AABBCC");
  assert.equal(normalizeHexColor(" #4f6bed "), "#4F6BED");
  assert.equal(normalizeHexColor("#12xz89"), null);
});

test("shared workspace pages use the current viewer accent", () => {
  assert.match(layout, /user_preferences/);
  assert.match(layout, /session\.profile\.id/);
  assert.match(layout, /"--accent": preferences\?\.accent_color/);
  assert.doesNotMatch(layout, /page\.original_owner_id/);
  assert.match(css, /color-mix\(in srgb, var\(--accent\)/);
  assert.doesNotMatch(css, /#e9e3f3|#e2efe6|#ebe6f4/);
  assert.match(layout, /export async function generateMetadata/);
  assert.match(layout, /session\.workspace\.name\?\.trim\(\) \|\| "TRPG Workspace"/);
});

test("registered TXT export uses personal defaults and one-time POST options", () => {
  assert.match(exportRoute, /user_preferences/);
  assert.match(exportRoute, /context\.user\.id/);
  assert.match(exportRoute, /export async function POST/);
  assert.match(exportDialog, /usePersonalDefaults/);
  assert.match(exportDialog, /method: "POST"/);
  assert.doesNotMatch(exportDialog, /method: "PATCH"|update_user_preferences/);
});

test("guest TXT export starts from system defaults without reading another user", () => {
  assert.match(guestLog, /usePersonalDefaults=\{false\}/);
  assert.match(guestExport, /parseCorrectionSettings/);
  assert.doesNotMatch(guestExport, /user_preferences|correction_settings/);
});
