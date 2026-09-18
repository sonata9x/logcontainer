import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("BGM controls stay outside paint containment and public logs have a narrow-screen row", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.entry-wrap > \.log-entry, \.public-log \.log-entry \{ content-visibility: auto/);
  assert.doesNotMatch(css, /\.entry-wrap\s*[,\{][^}]*content-visibility/);
  assert.match(css, /\.entry-bgm-button \{[^}]*left: -58px/);
  assert.match(css, /\.public-log \.entry-wrap:has\(> \.entry-bgm-button\) \{ padding-top: 34px/);
  assert.match(css, /@media \(max-width: 1100px\)[\s\S]*\.workspace-content \.entry-bgm-button, \.guest-log.is-editing \.entry-bgm-button \{ display: none/);
});

test("entry BGM follows stable entry identity, not its ordered index", () => {
  const editor = read("components/LogEditor.tsx");
  assert.match(editor, /data-entry-id=\{entry.id\} key=\{entry.id\}/);
  assert.match(editor, /item.role === "entry" && item.entry_id === entry.id/);
  assert.match(editor, /entryId=\{entry.id\} current=\{bgmItem\}/);
  for (const name of ["PublicLog", "GuestLog"]) {
    const source = read(`components/${name}.tsx`);
    assert.match(source, /item.entry_id === entry.id/);
    assert.match(source, /className="entry-wrap" key=\{entry.id\}/);
  }
});

test("BGM editor displays the current track and marks its library selection", () => {
  const editor = read("components/PageExtrasPanel.tsx");
  assert.match(editor, /aria-label="현재 BGM"/);
  assert.match(editor, /displayBgmTitle\(current\)/);
  assert.match(editor, /aria-pressed=\{current\?\.bgm_asset_id === item.bgm_asset_id\}/);
  assert.match(editor, /finally \{ setPending\(false\); \}/);
});

test("handout content gets the page font across portals while controls retain system font", () => {
  const handout = read("components/HandoutLibrary.tsx");
  assert.match(handout, /className="modal-card handout-modal" data-font=\{props.fontFamily \?\? "pretendard"\}/);
  assert.match(handout, /className="handout-title-input"/);
  const css = read("app/globals.css");
  assert.match(css, /\.handout-view-heading h2, \.handout-content, \.handout-title-input, \.handout-content-input \{ font-family: var\(--log-font-family/);
  assert.doesNotMatch(css, /\.handout-(?:trigger|modal)\s*\{[^}]*font-family:\s*var\(--log-font-family/);
  assert.match(read("components/LogEditor.tsx"), /fontFamily=\{pageExtras\?\.fontFamily\}/);
  assert.match(read("components/PublicLog.tsx"), /fontFamily=\{extras\?\.fontFamily\}/);
});
