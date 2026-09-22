import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");

test("workspace logs can switch to the publication-style read mode without publishing", () => {
  assert.match(editor, /const \[readMode, setReadMode\] = useState\(false\)/);
  assert.match(editor, /읽기 모드/);
  assert.match(editor, /수정 모드/);
  assert.match(editor, /className="public-log workspace-read-mode"/);
  assert.match(editor, /<SpeakerAvatarProvider avatars=\{speakerAvatars\}>/);
  assert.match(editor, /<HandoutLibrary mode="editor" pageId=\{page.id\} canEdit=\{false\}/);
  assert.match(editor, /<PublicBgmMenu pageId=\{page.id\} pageTitle=\{title\} \/>/);
  assert.match(editor, /\[liveEntries.length, loadMore, readMode, totalCount\]/);
  assert.doesNotMatch(editor, /setReadMode\(true\)[\s\S]{0,120}publication/);
});
