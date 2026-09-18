import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IMPORT_GUIDES } from "../components/ImportPlatformHelp";
import { importLogHtml } from "../lib/logs/import/registry";

test("platform guidance explains Roll20 full DOM copy, unsupported CCFOLIA and HTML export", () => {
  assert.deepEqual(IMPORT_GUIDES.map((guide) => guide.id), ["roll20", "ccfolia", "takoyaki-box"]);
  const roll20 = IMPORT_GUIDES[0].steps.join(" ");
  for (const text of ["Show on One Page", "F12", "Elements", "Ctrl+F", "textchatcontainer", "Copy element", "Copy outerHTML", "로그 HTML"]) assert.ok(roll20.includes(text));
  assert.match(IMPORT_GUIDES[0].note, /메시지 한 줄이 아니라 전체 채팅 컨테이너/);
  assert.match(IMPORT_GUIDES[1].note, /아직 가져오기를 지원하지 않습니다/);
  assert.match(IMPORT_GUIDES[2].steps.join(" "), /HTML 형식으로 내보냅니다/);
  assert.match(IMPORT_GUIDES[2].steps.join(" "), /\.html 파일/);
});

test("copied Roll20 container is accepted without a full HTML document or msgdata script", () => {
  const result = importLogHtml('<div class="textchatcontainer" id="textchat"><div class="message general" data-messageid="guide-1"><span class="by">GM:</span><span>안녕하세요.</span></div><div class="message general" data-messageid="guide-2"><span class="by">PC:</span><span>반갑습니다.</span></div></div>', "roll20");
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].speaker_name, "GM");
  assert.match(result.entries[0].content, /안녕하세요/);
  assert.equal(result.entries[1].speaker_name, "PC");
});

test("help is mounted in both initial and reimport forms with mouse, keyboard and touch access", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const help = read("components/ImportPlatformHelp.tsx");
  assert.match(read("components/LogEditor.tsx"), /<ImportPlatformHelp \/>/);
  assert.match(help, /event.pointerType === "mouse"/);
  assert.match(help, /onClick=.*setPinned/);
  assert.match(help, /:focus-visible/);
  assert.match(help, /event.key === "Escape"/);
  assert.match(help, /type="button"/);
  assert.match(help, /aria-describedby/);
  assert.match(read("app/globals.css"), /\.import-help-panel \{[^}]*width: min\(440px, 100%\)/);
});
