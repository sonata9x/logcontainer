import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { BGM_AUDIO_MAX_BYTES, parseYouTubeVideoId, validBgmUpload } from "../lib/bgm";
import { parseLogFontFamily, SESSION_CARD_MAX_BYTES, validSessionCard } from "../lib/page-extras";

const migration = readFileSync(new URL("../supabase/migrations/202609140001_page_extras_bgm.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
const playRoute = readFileSync(new URL("../app/api/bgm/play/route.ts", import.meta.url), "utf8");
const handoutCopy = readFileSync(new URL("../app/api/pages/[id]/handouts/copy/route.ts", import.meta.url), "utf8");
const handoutUi = readFileSync(new URL("../components/HandoutLibrary.tsx", import.meta.url), "utf8");
const libraryRoute = readFileSync(new URL("../app/api/bgm/library/route.ts", import.meta.url), "utf8");
const playlistRoute = readFileSync(new URL("../app/api/bgm/playlists/route.ts", import.meta.url), "utf8");
const playlistItemRoute = readFileSync(new URL("../app/api/bgm/playlists/items/route.ts", import.meta.url), "utf8");
const linkedPlaylistRoute = readFileSync(new URL("../app/api/pages/[id]/bgm/playlist/route.ts", import.meta.url), "utf8");

test("page extras validators keep fonts and private uploads bounded", () => {
  assert.equal(parseLogFontFamily("goun-batang"), "goun-batang");
  assert.equal(parseLogFontFamily("comic-sans"), "pretendard");
  assert.equal(validSessionCard("image/webp", SESSION_CARD_MAX_BYTES), true);
  assert.equal(validSessionCard("image/svg+xml", 100), false);
  assert.equal(validBgmUpload("audio/mpeg", BGM_AUDIO_MAX_BYTES), true);
  assert.equal(validBgmUpload("audio/wav", 100), false);
});

test("YouTube parsing accepts common canonical forms but not arbitrary hosts", () => {
  assert.equal(parseYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(parseYouTubeVideoId("https://example.com/watch?v=dQw4w9WgXcQ"), null);
});

test("BGM playback requires page-scoped authorization and a page usage", () => {
  assert.match(playRoute, /getPublicationAccess/);
  assert.match(playRoute, /getGuestApiContext/);
  assert.match(playRoute, /getApiPageContext/);
  assert.match(playRoute, /page_bgm_items/);
  assert.match(playRoute, /createSignedUrl/);
});

test("migration and canonical schema define private, reference-based BGM storage", () => {
  for (const sql of [migration, schema]) {
    assert.match(sql, /create table if not exists public\.bgm_assets/);
    assert.match(sql, /create table if not exists public\.bgm_library_items/);
    assert.match(sql, /create table if not exists public\.bgm_playlists/);
    assert.match(sql, /create table if not exists public\.page_bgm_items/);
    assert.match(sql, /'bgm-audio','bgm-audio',false/);
    assert.match(sql, /'session-cards','session-cards',false/);
    assert.match(sql, /sync_page_bgm_to_linked_playlists/);
  }
});

test("handout import copies selected rows and private image objects independently", () => {
  assert.match(handoutCopy, /\.copy\(image\.storage_path, path\)/);
  assert.match(handoutCopy, /randomUUID/);
  assert.match(handoutCopy, /createdIds/);
  assert.doesNotMatch(handoutUi, /handout\.content\.trim\(\)\.slice/);
  assert.doesNotMatch(handoutUi, /handout\.images\.length.*개 이미지/);
});

test("library and playlist APIs cover add remove aliases ordering and linked-page creation", () => {
  assert.match(libraryRoute, /export async function POST/);
  assert.match(libraryRoute, /export async function DELETE/);
  assert.match(libraryRoute, /publicationToken/);
  assert.match(playlistRoute, /export async function POST/);
  assert.match(playlistRoute, /export async function PATCH/);
  assert.match(playlistRoute, /export async function DELETE/);
  assert.match(playlistItemRoute, /custom_title/);
  assert.match(playlistItemRoute, /sort_order: index/);
  assert.match(linkedPlaylistRoute, /source_page_id: id/);
  assert.match(linkedPlaylistRoute, /ignoreDuplicates: true/);
  assert.match(migration, /on conflict \(playlist_id, bgm_asset_id\) do nothing/);
});
