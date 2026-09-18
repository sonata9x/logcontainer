import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const sql = read("supabase/migrations/202609170001_fix_page_extras_bgm_writes.sql");

test("page extras write RPC checks permission and restricts mutable metadata", () => {
  assert.match(sql, /auth.uid\(\) is null or not public.can_edit_resource/);
  assert.match(sql, /changes - array\['overview','font_family','session_card_path','session_card_mime','session_card_size'\]/);
  assert.match(sql, /for update/);
  assert.match(sql, /revoke all on function public.update_page_extras.*from public, anon/);
  for (const file of ["extras", "session-card"]) {
    const route = read(`app/api/pages/[id]/${file}/route.ts`);
    assert.match(route, /rpc\("update_page_extras"/);
    assert.doesNotMatch(route, /from\("pages"\).update/);
  }
});

test("new BGM owner can select INSERT RETURNING without stable snapshot lookup", () => {
  assert.match(sql, /using \(\(owner_user_id = auth.uid\(\) and deleted_at is null\)/);
  assert.match(sql, /or public.can_access_bgm_asset\(id, auth.uid\(\)\)/);
});

test("YouTube creation uses in-page dialogs and releases pending on failure", () => {
  for (const file of ["BgmManager", "BgmSourceCreator"]) {
    const ui = read(`components/${file}.tsx`);
    assert.match(ui, /BgmDetailsDialog/);
    assert.doesNotMatch(ui, /event.currentTarget.reset/);
    assert.match(ui, /finally \{ setPending\(false\); \}/);
  }
  const dialog = read("components/BgmDetailsDialog.tsx");
  assert.match(dialog, /role="dialog" aria-modal="true"/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /parseYouTubeVideoId\(url\)/);
});

test("MP3 upload uses an accessible in-page title dialog instead of browser prompt", () => {
  const dialog = read("components/BgmUploadDialog.tsx");
  assert.match(dialog, /role="dialog" aria-modal="true" aria-label="MP3 업로드"/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /await onUpload\(title.trim\(\)\)/);
  assert.match(dialog, /pending \|\| !title.trim\(\)/);
  for (const file of ["BgmManager", "BgmSourceCreator"]) {
    const ui = read(`components/${file}.tsx`);
    assert.match(ui, /<BgmUploadDialog/);
    assert.doesNotMatch(ui, /window.prompt\("BGM 제목"/);
    assert.match(ui, /throw new Error\("25MB 이하 MP3/);
  }
});

test("Rich absolute offsets anchor to message flow, not synthetic block wrapper", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.r20-message__content-flow \{ position: relative;/);
  assert.match(css, /\.r20-rich-context--block \{ position: static;/);
});

test("empty pages expose manual content creation and handout header has accessible icons", () => {
  assert.match(read("components/LogEditor.tsx"), /totalCount === 0 && permissions.canEdit/);
  assert.match(read("components/LogEditor.tsx"), /InlineAddForm onSubmit=\{addFirstEntry\}/);
  const ui = read("components/HandoutLibrary.tsx");
  for (const action of ["수정", "삭제", "닫기"]) assert.ok(ui.includes(`aria-label="핸드아웃 ${action}"`));
});

test("waiting BGM replacement is permission-checked atomic and constrained to one row", () => {
  const sql = read("supabase/migrations/202609170002_single_waiting_bgm.sql");
  assert.match(sql, /create unique index if not exists page_bgm_one_waiting_idx[\s\S]*\(page_id\) where role = 'waiting'/);
  assert.match(sql, /actor_id is null or not public.can_edit_resource/);
  assert.match(sql, /can_access_bgm_asset\(target_asset_id, actor_id\)/);
  assert.match(sql, /and is_ready and deleted_at is null for share/);
  assert.match(sql, /not is_archived for update/);
  assert.match(sql, /partition by page_id order by created_at desc, sort_order desc, id desc/);
  assert.match(sql, /delete from public.page_bgm_items where page_id = target_page_id and role = 'waiting'/);
  assert.match(sql, /revoke all on function public.set_page_waiting_bgm.*from public, anon/);
  assert.doesNotMatch(sql, /delete from public\.(bgm_assets|bgm_library_items|bgm_playlist_items)/);
  const route = read("app/api/pages/[id]/bgm/route.ts");
  assert.match(route, /if \(role === "waiting"\)[\s\S]*rpc\("set_page_waiting_bgm"/);
  const ui = read("components/PageExtrasPanel.tsx");
  assert.match(ui, /bgmItems.filter\(\(item\) => item.role !== "waiting"\), result.item/);
  assert.match(ui, /다른 곡을 선택하면 현재 대기 BGM을 교체합니다/);
});

test("BGM playback icons have no circular border and retain focus styling", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.global-bgm-player button, \.bgm-play-button \{[^}]*border: 0;[^}]*background: transparent/);
  assert.match(css, /\.bgm-play-button \{ background: transparent; color: var\(--muted\)/);
  assert.match(css, /\.bgm-play-button:hover \{ background: transparent; color: var\(--text\)/);
  assert.match(css, /\.global-bgm-player button:hover \{ background: var\(--hover\)/);
});
