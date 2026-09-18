import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { canImportPageBgm, uniquePagePlaylistUsages } from "../lib/bgm-playlist";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("locked invalid and mismatched publications never authorize BGM copying", () => {
  const input = { pageId: "page-a", publicationTokenProvided: true, publication: null, canViewPage: true };
  assert.equal(canImportPageBgm(input), false);
  assert.equal(canImportPageBgm({ ...input, publication: { pageId: "page-a", authorized: false } }), false);
  assert.equal(canImportPageBgm({ ...input, publication: { pageId: "page-b", authorized: true } }), false);
  assert.equal(canImportPageBgm({ ...input, publication: { pageId: "page-a", authorized: true } }), true);
  assert.equal(canImportPageBgm({ ...input, publicationTokenProvided: false }), true);
  assert.equal(canImportPageBgm({ ...input, publicationTokenProvided: false, canViewPage: false }), false);
});

test("page playlist snapshot deduplicates waiting and message usages without mutating input", () => {
  const usages = [
    { bgm_asset_id: "piano", custom_title: "Waiting" },
    { bgm_asset_id: "piano", custom_title: "Message" },
    { bgm_asset_id: "youtube", custom_title: null }
  ];
  const original = structuredClone(usages);
  assert.deepEqual(uniquePagePlaylistUsages(usages), [usages[0], usages[2]]);
  assert.deepEqual(usages, original);
  assert.deepEqual(uniquePagePlaylistUsages([]), []);
  const large = Array.from({ length: 1201 }, (_, index) => ({ bgm_asset_id: String(index), custom_title: null }));
  assert.equal(uniquePagePlaylistUsages([...large, ...large]).length, 1201);
});

test("playlist import validates both source authorization and destination ownership", () => {
  const api = read("app/api/pages/[id]/bgm/playlist/route.ts");
  assert.match(api, /getApprovedApiContext\(\)/);
  assert.match(api, /getApiPageContext\(id\)/);
  assert.match(api, /getPublicationAccess\(body.publicationToken, request.cookies.get\(PUBLICATION_SESSION_COOKIE\)/);
  assert.match(api, /publication\?\.authorized && publication.page.id === id/);
  assert.match(api, /eq\("id", playlistId\).eq\("user_id", viewer.user.id\)/);
  assert.match(api, /eq\("page_id", id\).eq\("asset.is_ready", true\).is\("asset.deleted_at", null\)/);
  assert.match(api, /item.role === "waiting" \|\| \(entry && !entry.is_deleted\)/);
  assert.match(api, /range\(offset, offset \+ 499\)/);
  assert.match(api, /ignoreDuplicates: true, count: "exact"/);
  assert.match(api, /rollbackNewPlaylist/);
  assert.doesNotMatch(api, /body.assetId|source_page_id: id/);
});

test("all per-track library controls are removed in favor of a full-log menu action", () => {
  for (const name of ["LogEditor", "PublicLog", "PageExtrasPanel", "BgmPlayer"]) {
    assert.doesNotMatch(read(`components/${name}.tsx`), /BgmLibraryAddButton/);
  }
  assert.match(read("components/LogEditor.tsx"), /로그 BGM 전체 담기/);
  assert.match(read("components/PublicLog.tsx"), /PublicBgmMenu/);
  const dialog = read("components/BgmPlaylistDialog.tsx");
  assert.match(dialog, /playlistId: target \|\| undefined, publicationToken/);
  assert.match(dialog, /새 플레이리스트/);
  assert.match(dialog, /disabled=\{loading \|\| pending/);
  assert.doesNotMatch(dialog, /window.prompt|window.alert/);
});

test("narrow-editor playback is hidden but public playback remains visible", () => {
  const css = read("app/globals.css");
  const rule = css.match(/@media \(max-width: 1100px\) \{([^}]+)\}/)?.[1] ?? "";
  assert.match(rule, /\.workspace-content \.entry-bgm-button, \.guest-log.is-editing \.entry-bgm-button \{ display: none/);
  assert.doesNotMatch(rule, /\.public-log/);
  assert.match(css, /\.public-log \.entry-bgm-button \{ left: 0; top: 50%/);
  assert.doesNotMatch(css, /\.entry-wrap > \.bgm-library-add/);
  assert.match(css, /\.bgm-play-button \{ background: transparent; color: var\(--muted\)/);
  assert.match(css, /\.bgm-play-button:hover \{ background: transparent; color: var\(--text\)/);
});

test("theme accent reaches portals, restores on exit, and hover does not lose theme color", () => {
  const appearance = read("components/WorkspaceAppearance.tsx");
  assert.match(appearance, /document.body.style.setProperty\("--accent", color\)/);
  assert.match(appearance, /document.body.style.removeProperty\("--accent"\)/);
  assert.match(appearance, /normalizeHexColor\(accentColor\)/);
  assert.match(read("components/WorkspaceSidebar.tsx"), /setAccentColor\(next.accentColor\)/);
  const css = read("app/globals.css");
  assert.match(css, /\.button-primary:hover \{ background: color-mix\(in srgb, var\(--accent\)/);
  assert.match(css, /input\[type="range"\] \{ accent-color: var\(--accent\)/);
  assert.match(css, /\.member-row select \{[^}]*font-family: var\(--system-font-family/);
  assert.match(css, /\.member-remove \{[^}]*border: 0/);
  assert.equal((read("components/WorkspaceSidebar.tsx").match(/className="member-remove"/g) ?? []).length, 2);
});
