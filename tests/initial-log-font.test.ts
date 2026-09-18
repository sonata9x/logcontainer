import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicLog } from "../components/PublicLog";
import { LogFontPreload } from "../components/logs/LogFontPreload";
import { LOG_FONT_OPTIONS } from "../lib/fonts";
import { logFontPreload } from "../lib/log-font-preload";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("published first server render already contains the saved font before client extras fetch", () => {
  for (const { value } of LOG_FONT_OPTIONS) {
    const html = renderToStaticMarkup(createElement(PublicLog, { token: "exampleToken", title: "Example", initialEntries: [], totalCount: 0, initialFontFamily: value }));
    assert.ok(html.includes(`data-font="${value}"`));
  }
});

test("approved workspace loads typography through RLS and public route passes it only after access gating", () => {
  const workspace = read("app/workspace/pages/[id]/page.tsx");
  assert.match(workspace, /supabase.from\("pages"\).select\("font_family"\).eq\("id", id\).single\(\)/);
  assert.match(workspace, /await Promise.all\(/);
  assert.match(workspace, /font_family: fontFamily/);
  assert.match(workspace, /page=\{initialPage\}/);
  assert.ok(workspace.indexOf("await requireApprovedSession()") < workspace.indexOf('select("font_family")'));
  assert.doesNotMatch(workspace, /createSupabaseAdminClient/);
  assert.match(read("components/LogEditor.tsx"), /data-font=\{pageExtras\?\.fontFamily \?\? page.font_family \?\? "pretendard"\}/);
  const published = read("app/p/[token]/page.tsx");
  assert.ok(published.indexOf("if (!access.authorized)") < published.indexOf("parseLogFontFamily(access.page.font_family)"));
  assert.match(published, /initialFontFamily=\{fontFamily\} key=\{token\}/);
  assert.match(read("lib/publication-auth.ts"), /deleted_at, font_family/);
  // Guest logs load typography and entries together before displaying content.
  assert.match(read("components/GuestLog.tsx"), /data-font=\{payload.extras\?\.fontFamily/);
});

test("selected direct font preloads match actual CSS assets and do not request unrelated fonts", () => {
  const css = read("app/globals.css");
  for (const { value } of LOG_FONT_OPTIONS) {
    const resource = logFontPreload(value);
    const html = renderToStaticMarkup(createElement(LogFontPreload, { font: value }));
    if (!resource) { assert.equal(html, ""); continue; }
    assert.ok(css.includes(resource.href));
    assert.match(html, /rel="preload" as="font"/);
    assert.match(html, /crossorigin="anonymous"/);
    assert.ok(html.includes(resource.href));
    assert.equal((html.match(/rel="preload"/g) ?? []).length, 1);
  }
});
