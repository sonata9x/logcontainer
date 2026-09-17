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

test("async YouTube forms retain the form and release pending on failure", () => {
  for (const file of ["BgmManager", "BgmSourceCreator"]) {
    const ui = read(`components/${file}.tsx`);
    assert.match(ui, /const element = event.currentTarget/);
    assert.match(ui, /element.reset\(\)/);
    assert.doesNotMatch(ui, /event.currentTarget.reset/);
    assert.match(ui, /finally \{ setPending\(false\); \}/);
  }
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
