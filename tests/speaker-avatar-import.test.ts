import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validImportedAvatarSource } from "../lib/speaker-avatar-import";

test("imported avatar preservation accepts known public image hosts but rejects SSRF targets", () => {
  assert.equal(validImportedAvatarSource("https://files.d20.io/images/123/avatar.png"), true);
  assert.equal(validImportedAvatarSource("https://s3.amazonaws.com/files.d20.io/images/avatar.png"), true);
  assert.equal(validImportedAvatarSource("https://cdn.example.cloudfront.net/avatar.webp"), true);
  assert.equal(validImportedAvatarSource("http://files.d20.io/avatar.png"), false);
  assert.equal(validImportedAvatarSource("https://127.0.0.1/avatar.png"), false);
  assert.equal(validImportedAvatarSource("https://example.com/avatar.png"), false);
});

test("avatar import is bounded, validates raster signatures, and is reachable from management", () => {
  const importer = readFileSync(new URL("../lib/speaker-avatar-import.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/pages/[id]/speaker-avatars/route.ts", import.meta.url), "utf8");
  const editor = readFileSync(new URL("../components/LogEditor.tsx", import.meta.url), "utf8");
  assert.match(importer, /SPEAKER_AVATAR_MAX_BYTES/);
  assert.match(importer, /hasImageSignature/);
  assert.match(importer, /AbortSignal\.timeout/);
  assert.match(route, /body\.importOriginal === true/);
  assert.match(route, /saveImportedDefault/);
  assert.match(editor, /화자·표정 관리/);
});
