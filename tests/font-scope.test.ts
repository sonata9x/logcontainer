import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fontFamilyStack, isLogFontFamily, LOG_FONT_OPTIONS, parseLogFontFamily } from "../lib/fonts";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("shared font whitelist rejects CSS injection and resolves every available font", () => {
  for (const option of LOG_FONT_OPTIONS) {
    assert.equal(isLogFontFamily(option.value), true);
    assert.equal(parseLogFontFamily(option.value), option.value);
    assert.ok(fontFamilyStack(option.value).length > 0);
  }
  for (const bad of [null, "__proto__", "constructor", "serif; background:url(evil)", {}]) {
    assert.equal(isLogFontFamily(bad), false);
    assert.equal(parseLogFontFamily(bad), "pretendard");
  }
});

test("page font scopes to title and content while system font reaches UI and portals", () => {
  const css = read("app/globals.css");
  assert.match(css, /\[data-font="ridi-batang"\] \{ --log-font-family:/);
  assert.doesNotMatch(css, /\[data-font="[^"]+"\] \{ font-family:/);
  assert.match(css, /\.page-title-input, \.public-log > h1, \.page-overview, \.log-entry \{\s*font-family: var\(--log-font-family/);
  assert.match(css, /\.log-entry button[^}]*\.r20-message__timestamp[^}]*--system-font-family/);
  const provider = read("components/WorkspaceAppearance.tsx");
  assert.match(provider, /document.body.style.setProperty\("--system-font-family", stack\)/);
  assert.match(provider, /document.body.style.removeProperty\("--system-font-family"\)/);
  assert.match(read("components/WorkspaceSidebar.tsx"), /시스템 글꼴<select/);
  assert.match(read("components/WorkspaceSidebar.tsx"), /setSystemFont\(next.systemFont\)/);
});

test("system font preference is viewer-scoped and does not alter resource typography", () => {
  const sql = read("supabase/migrations/202609170003_system_font_preferences.sql");
  assert.match(sql, /public.user_preferences add column if not exists system_font_family/);
  assert.match(sql, /system_font_family in \('pretendard'/);
  assert.doesNotMatch(sql, /^\s*(create policy|alter table public\.pages|grant\s)/m);
  const route = read("app/api/account/settings/route.ts");
  assert.match(route, /!isLogFontFamily\(body.systemFont\)/);
  assert.match(route, /update\(\{ system_font_family: body.systemFont \}\).eq\("user_id", context.user.id\)/);
  assert.match(read("app/workspace/layout.tsx"), /system_font_family"\).eq\("user_id", session.profile.id\)/);
});
