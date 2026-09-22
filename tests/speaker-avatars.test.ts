import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeSpeakerKey, resolveEntryAvatar, SPEAKER_AVATAR_PLATFORMS } from "../lib/speaker-avatars";
import type { LogEntry, SpeakerAvatarBundle } from "../lib/types";

function entry(id = "entry-1"): LogEntry {
  return {
    id, log_id: "log", order_index: 0, sort_key: 0, entry_type: "dialogue",
    speaker_name: " GM ", speaker_color: null, content: "hello", raw_html: null,
    document_version: 2,
    document: {
      version: 2, kind: "dialogue",
      source: { platform: "roll20", messageId: null, sourceKey: null, sourceOrder: 0 },
      speaker: { name: " GM ", color: null, avatarUrl: "https://roll20.example/original.png" },
      timestamp: { raw: null, iso: null },
      presentation: { speakerExplicit: true, avatarExplicit: true, timestampExplicit: false, continuation: false },
      blocks: [{ id: "text", type: "text", text: "hello" }], warnings: []
    },
    is_deleted: false, deleted_at: null, is_added: false, updated_by: null, created_at: "", updated_at: ""
  };
}

const bundle: SpeakerAvatarBundle = {
  enabled: true,
  platform: "roll20",
  profiles: [{ id: "profile", speakerKey: "gm", speakerName: "GM", messageCount: 3, variants: [
    { id: "default", name: "기본", isDefault: true, imageUrl: "https://private.example/default", originalFilename: "default.png", sortOrder: 0 },
    { id: "happy", name: "기쁨", isDefault: false, imageUrl: "https://private.example/happy", originalFilename: "happy.png", sortOrder: 1 }
  ] }],
  entryOverrides: {}
};

test("speaker identity normalization is stable for spacing and case", () => {
  assert.equal(normalizeSpeakerKey("  G M  "), "g m");
  assert.ok(SPEAKER_AVATAR_PLATFORMS.has("roll20"));
  assert.ok(SPEAKER_AVATAR_PLATFORMS.has("takoyaki-box"));
  assert.equal(SPEAKER_AVATAR_PLATFORMS.has("ccfolia"), false);
});

test("expression, default, original priority never mutates canonical data", () => {
  const source = entry();
  assert.deepEqual(resolveEntryAvatar(source, bundle).candidates, ["https://private.example/default", "https://roll20.example/original.png"]);
  const expression = resolveEntryAvatar(source, { ...bundle, entryOverrides: { [source.id]: "happy" } });
  assert.deepEqual(expression.candidates, ["https://private.example/happy", "https://private.example/default", "https://roll20.example/original.png"]);
  assert.equal(source.document!.speaker!.avatarUrl, "https://roll20.example/original.png");
  assert.deepEqual(resolveEntryAvatar(source, { ...bundle, profiles: [] }).candidates, ["https://roll20.example/original.png"]);
});

test("migration keeps avatar storage private and canonical documents separate", () => {
  const sql = readFileSync(new URL("../supabase/migrations/202609220001_speaker_avatar_expressions.sql", import.meta.url), "utf8");
  assert.match(sql, /'speaker-avatars',[\s\S]*false/);
  assert.match(sql, /create table if not exists public\.log_entry_avatar_overrides/);
  assert.doesNotMatch(sql, /alter table public\.log_entries add column/);
  assert.match(sql, /speaker_avatars_changed/);
});
