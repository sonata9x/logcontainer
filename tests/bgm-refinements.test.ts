import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_ACCENT_COLOR } from "../lib/color";
import { BGM_USAGE_FILTERS } from "../lib/bgm-admin";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("management has a single sidebar entry and accessible active tabs inside the page", () => {
  const sidebar = read("components/WorkspaceSidebar.tsx");
  assert.match(sidebar, /<ShieldCheck size=\{15\} \/>관리<\/Link>/);
  assert.doesNotMatch(sidebar, /sidebar-admin|href="\/workspace\/admin\/bgm"/);
  const navigation = read("components/AdminNavigation.tsx");
  assert.match(navigation, /usePathname\(\)/);
  assert.match(navigation, /aria-current=\{pathname === tab.href \? "page" : undefined\}/);
  assert.match(read("app/workspace/admin/layout.tsx"), /<AdminNavigation\s*\/>/);
  assert.match(read("app/globals.css"), /a\[aria-current="page"\][^}]+border-bottom-color: var\(--accent\)/);
});

test("BGM title contains status notices and usage filters reach server pagination", () => {
  const panel = read("components/AdminBgmPanel.tsx");
  assert.match(panel, /className="admin-bgm-title-line"><strong>\{asset.title\}<\/strong><span className="bgm-usage-badge"/);
  assert.match(panel, /recentBgmUpload\(asset\) && <small className="bgm-protection-badge"/);
  assert.match(panel, /aria-pressed=\{usage === filter.value\}/);
  assert.match(panel, /&usage=\$\{usage\}/);
  assert.deepEqual(BGM_USAGE_FILTERS.map((filter) => filter.value), ["all", "no-page", "library-only", "unreferenced"]);
  assert.match(read("app/api/admin/bgm/route.ts"), /usage_filter: filter/);
  const migration = read("supabase/migrations/202609180002_bgm_edit_and_neutral_theme.sql");
  assert.match(migration, /bgm_matches_usage_filter\(a.id, usage_filter\)[\s\S]+limit 100 offset/);
});

test("BGM naming uses page dialogs and YouTube editing is authenticated and validated", () => {
  for (const path of ["components/BgmManager.tsx", "components/BgmSourceCreator.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /window\.prompt/);
    assert.match(source, /BgmDetailsDialog/);
    assert.match(source, /BgmUploadDialog/);
  }
  const dialog = read("components/BgmDetailsDialog.tsx");
  assert.match(dialog, /role="dialog" aria-modal="true"/);
  assert.match(dialog, /readOnly=\{!canEditUrl\}/);
  assert.match(dialog, /canEditUrl \? \{ youtubeUrl: url.trim\(\) \} : \{\}/);
  assert.match(dialog, /role="alert"/);
  const api = read("app/api/bgm/library/route.ts");
  const patch = api.slice(api.indexOf("export async function PATCH"), api.indexOf("export async function DELETE"));
  assert.match(patch, /getApprovedApiContext\(\)/);
  assert.match(patch, /parseYouTubeVideoId\(body.youtubeUrl\)/);
  assert.match(patch, /rpc\("update_bgm_library_details"/);
  assert.match(api, /can_edit_source: Boolean\(asset\?\.owner_user_id === context.user.id \|\| context.isSiteAdmin\)/);
});

test("YouTube source changes stop local playback and next playback refetches the source", () => {
  const player = read("components/BgmPlayer.tsx");
  assert.match(player, /current\?\.id === item.id && source\?\.type === "upload"/);
  assert.doesNotMatch(player, /current\?\.id === item.id && source\?\.type === "youtube"/);
  assert.match(player, /fetch\(`\/api\/bgm\/play\?\$\{params\}`, \{ cache: "no-store" \}\)/);
  assert.match(player, /detail\?\.assetId === current\?\.bgm_asset_id\) stop\(\)/);
  assert.match(player, /removeEventListener\("bgm-source-updated", changed\)/);
  assert.match(read("components/BgmManager.tsx"), /result.sourceUpdated\) window.dispatchEvent/);
});

test("default and unauthenticated theme is neutral while custom account color remains supported", () => {
  assert.equal(DEFAULT_ACCENT_COLOR, "#62625F");
  assert.match(read("app/globals.css"), /--accent: #62625f;/);
  for (const path of ["components/WorkspaceAppearance.tsx", "app/api/account/settings/route.ts", "app/workspace/layout.tsx"]) {
    const source = read(path);
    assert.match(source, /DEFAULT_ACCENT_COLOR/);
    assert.doesNotMatch(source, /#4f6bed/i);
  }
  assert.match(read("components/WorkspaceAppearance.tsx"), /normalizeHexColor\(accentColor\)/);
});
