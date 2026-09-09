import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { HANDOUT_IMAGE_MAX_BYTES, validHandoutImage } from "../lib/handouts";

const editorRoute = readFileSync(new URL("../app/api/pages/[id]/handouts/route.ts", import.meta.url), "utf8");
const uploadRoute = readFileSync(new URL("../app/api/pages/[id]/handouts/[handoutId]/images/upload/route.ts", import.meta.url), "utf8");
const publicRoute = readFileSync(new URL("../app/api/publications/[token]/handouts/route.ts", import.meta.url), "utf8");
const purgeRoute = readFileSync(new URL("../app/api/internal/purge/route.ts", import.meta.url), "utf8");
const handoutHelper = readFileSync(new URL("../lib/handouts.ts", import.meta.url), "utf8");
const component = readFileSync(new URL("../components/HandoutLibrary.tsx", import.meta.url), "utf8");

test("handout images accept only bounded browser-safe raster formats", () => {
  assert.equal(validHandoutImage("image/png", 1), true);
  assert.equal(validHandoutImage("image/webp", HANDOUT_IMAGE_MAX_BYTES), true);
  assert.equal(validHandoutImage("image/svg+xml", 100), false);
  assert.equal(validHandoutImage("image/png", HANDOUT_IMAGE_MAX_BYTES + 1), false);
});

test("handout mutation is editor-only while publication access is read-only", () => {
  assert.match(editorRoute, /context\?\.canEdit/);
  assert.match(uploadRoute, /context\?\.canEdit/);
  assert.match(uploadRoute, /createSignedUploadUrl/);
  assert.match(publicRoute, /getPublicationAccess/);
  assert.match(publicRoute, /access\?\.authorized/);
  assert.doesNotMatch(publicRoute, /export async function (POST|PATCH|DELETE)/);
});

test("handout UI supports text, paste/upload images, and public read-only mode", () => {
  assert.match(component, /onPaste=/);
  assert.match(component, /uploadToSignedUrl/);
  assert.match(component, /mode: "public"/);
  assert.match(component, /const canEdit = editor && props\.canEdit/);
});

test("private handout image storage is cleaned for abandoned uploads and purged pages", () => {
  assert.match(handoutHelper, /purgeStaleHandoutUploads/);
  assert.match(handoutHelper, /eq\("is_ready", false\)[\s\S]*lt\("created_at", cutoff\)/);
  assert.match(handoutHelper, /purgeExpiredResourceHandoutImages/);
  assert.match(handoutHelper, /HANDOUT_IMAGE_BUCKET\)\.remove/);
  assert.match(purgeRoute, /purgeExpiredResourceHandoutImages\(admin\)/);
  assert.match(purgeRoute, /purgeStaleHandoutUploads\(admin\)/);
});
