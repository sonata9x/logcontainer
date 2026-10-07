import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("log timelines keep scroll loading and progressively preload remaining batches", () => {
  const hook = read("components/logs/useProgressiveLogPreload.ts");
  const editor = read("components/LogEditor.tsx");
  const published = read("components/PublicLog.tsx");
  const guest = read("components/GuestLog.tsx");

  assert.match(hook, /BACKGROUND_BATCH_DELAY_MS = 1_200/);
  assert.match(hook, /requestIdleCallback/);
  assert.match(hook, /if \(!hasMore \|\| loading\) return/);
  for (const source of [editor, published, guest]) {
    assert.match(source, /useProgressiveLogPreload/);
    assert.match(source, /IntersectionObserver/);
  }
  assert.match(editor, /loadMore\(true\)/);
  assert.match(guest, /loadingMoreRef/);
});
