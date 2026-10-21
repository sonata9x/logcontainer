import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createStoredZip } from "../lib/external-export/zip";
import { buildExternalIndexHtml } from "../lib/external-export/viewer";
import { currentManagedAvatarVariantId, renderExternalEntries, safeAssetExtension, safeExportName } from "../lib/external-export/server";
import type { ExternalLogExportManifest } from "../lib/external-export/types";
import type { LogEntry, SpeakerAvatarBundle } from "../lib/types";

test("stored ZIP contains UTF-8 paths and a valid central directory", async () => {
  const zip = await createStoredZip([{ path: "manifest.json", data: "{}" }, { path: "assets/bgm/시간.mp3", data: new Uint8Array([1, 2, 3]) }]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(new TextDecoder().decode(bytes).includes("assets/bgm/시간.mp3"), true);
});

test("external HTML embeds inert versioned manifest and viewer controls", () => {
  const manifest: ExternalLogExportManifest = {
    format: "logcontainer-static-log", version: 1, exportedAt: "2026-10-21T00:00:00.000Z",
    page: { title: "세션 </script>", platform: "roll20", fontFamily: "pretendard", overview: "개요" },
    entries: [{ key: "entry-1", html: "<div class=\"log-entry\">본문</div>", compactSpacing: false, stream: "main" }],
    tracks: [{ key: "track-1", title: "곡", source: { type: "upload", file: "assets/bgm/a.mp3", mimeType: "audio/mpeg", originalFilename: "a.mp3" } }],
    bgm: [{ key: "bgm-1", trackKey: "track-1", title: "곡", role: "entry", entryKey: "entry-1", sortOrder: 0 }], handouts: []
  };
  const html = buildExternalIndexHtml(manifest);
  assert.match(html, /type="application\/json" id="logcontainer-export"/);
  assert.match(html, /data-bgm-placement="bgm-1"/);
  assert.match(html, /세션 &lt;\/script&gt;/);
  assert.doesNotMatch(html, /"title":"세션 <\/script>/);
});

test("read-only entry renderer keeps the current canonical presentation", () => {
  const entry = {
    id: "entry-id", log_id: "log", order_index: 0, sort_key: 1, entry_type: "dialogue", speaker_name: "진희령", speaker_color: null,
    content: "안녕하세요", raw_html: null, document_version: 2, is_deleted: false, deleted_at: null, is_added: false, updated_by: null, created_at: "", updated_at: "",
    document: { version: 2, kind: "dialogue", source: { platform: "roll20", messageId: "1", sourceKey: "1", sourceOrder: 0 }, speaker: { name: "진희령", color: null, avatarUrl: null }, timestamp: { raw: "July 11, 2026 12:34AM", iso: null }, presentation: { speakerExplicit: true, avatarExplicit: false, timestampExplicit: true, continuation: false }, blocks: [{ id: "text", type: "text", text: "안녕하세요" }], warnings: [] }
  } as LogEntry;
  const rendered = renderExternalEntries([entry], null);
  assert.equal(rendered[0].key, "entry-entry-id");
  assert.match(rendered[0].html, /r20-message__speaker">진희령:/);
  assert.match(rendered[0].html, /July 11, 2026 12:34AM/);
  assert.match(rendered[0].html, /안녕하세요/);
});

test("external export only packages the managed avatar currently shown for an entry", () => {
  const entry = {
    id: "entry-id", log_id: "log", order_index: 0, sort_key: 1, entry_type: "dialogue", speaker_name: "진희령", speaker_color: null,
    content: "안녕하세요", raw_html: null, document_version: 2, is_deleted: false, deleted_at: null, is_added: false, updated_by: null, created_at: "", updated_at: "",
    document: { version: 2, kind: "dialogue", source: { platform: "roll20", messageId: "1", sourceKey: "1", sourceOrder: 0 }, speaker: { name: "진희령", color: null, avatarUrl: null }, timestamp: { raw: "", iso: null }, presentation: { speakerExplicit: true, avatarExplicit: false, timestampExplicit: false, continuation: false }, blocks: [{ id: "text", type: "text", text: "안녕하세요" }], warnings: [] }
  } as LogEntry;
  const avatars: SpeakerAvatarBundle = {
    enabled: true, platform: "roll20", entryOverrides: { "entry-id": "sad" }, profiles: [{
      id: "profile", speakerKey: "진희령", speakerName: "진희령", messageCount: 1, originalAvatarUrl: null,
      variants: [
        { id: "default", name: "기본", isDefault: true, imageUrl: "default.png", originalFilename: null, sortOrder: 0 },
        { id: "sad", name: "슬픔", isDefault: false, imageUrl: "sad.png", originalFilename: null, sortOrder: 1 },
        { id: "unused", name: "기쁨", isDefault: false, imageUrl: "happy.png", originalFilename: null, sortOrder: 2 }
      ]
    }]
  };
  assert.equal(currentManagedAvatarVariantId(entry, avatars), "sad");
  assert.equal(currentManagedAvatarVariantId({ ...entry, id: "default-entry" }, avatars), "default");
  assert.equal(currentManagedAvatarVariantId({ ...entry, document: { ...entry.document!, presentation: { speakerExplicit: false, avatarExplicit: false, timestampExplicit: false, continuation: true } } }, avatars), null);
});

test("external export is owner-only and private assets are proxied after page validation", () => {
  const route = readFileSync(new URL("../app/api/pages/[id]/external-export/route.ts", import.meta.url), "utf8");
  const asset = readFileSync(new URL("../app/api/pages/[id]/external-export/asset/route.ts", import.meta.url), "utf8");
  assert.match(route, /!context\.canReimport/);
  assert.match(asset, /!context\.canReimport/);
  assert.match(asset, /page_bgm_items/);
  assert.match(asset, /page_speaker_profiles/);
  assert.doesNotMatch(route, /storage_path.*manifest/);
  assert.equal(safeAssetExtension("avatar.WEBP", "img"), "webp");
  assert.equal(safeExportName("a/b:c"), "a_b_c");
});
