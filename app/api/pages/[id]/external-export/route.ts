import { NextRequest, NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { LOG_ENTRY_DTO_COLUMNS, toLogEntryDto } from "@/lib/logs/dto";
import { getPageBgmItems, displayBgmTitle } from "@/lib/bgm";
import { getSpeakerAvatarBundle } from "@/lib/speaker-avatars";
import { parseLogFontFamily } from "@/lib/fonts";
import { normalizeEntryTimestampDisplay } from "@/lib/logs/statistics";
import { assetExtensionForMime, exportEntryKey, renderExternalEntries, safeAssetExtension, safeExportName } from "@/lib/external-export/server";
import { EXTERNAL_LOG_EXPORT_FORMAT, EXTERNAL_LOG_EXPORT_VERSION, type ExternalExportAsset, type ExternalExportHandout, type ExternalExportTrack, type ExternalLogExportManifest } from "@/lib/external-export/types";
import type { LogEntry, SpeakerAvatarBundle } from "@/lib/types";

const ENTRY_BATCH_SIZE = 250;

type HandoutRow = { id: string; title: string; content: string; order_index: number };
type HandoutImageRow = { id: string; handout_id: string; original_name: string; mime_type: string; byte_size: number; order_index: number };
type AvatarRow = { id: string; storage_path: string };

function assetUrl(pageId: string, kind: string, assetId: string) {
  return `/api/pages/${encodeURIComponent(pageId)}/external-export/asset?kind=${encodeURIComponent(kind)}&assetId=${encodeURIComponent(assetId)}`;
}

function uniqueAssets(assets: ExternalExportAsset[]) {
  return [...new Map(assets.map((asset) => [asset.path, asset])).values()];
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log" || !context.canReimport) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const offsetValue = Number(new URL(request.url).searchParams.get("offset") ?? "0");
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const admin = createSupabaseAdminClient();

  const [{ data: page, error: pageError }, { data: log, error: logError }] = await Promise.all([
    context.supabase.from("pages").select("title, overview, font_family, session_card_path, session_card_mime, session_card_size").eq("id", id).single(),
    context.supabase.from("logs").select("id, platform").eq("page_id", id).single()
  ]);
  if (pageError || logError || !page || !log) return NextResponse.json({ error: "외부용 로그 정보를 불러오지 못했습니다." }, { status: 500 });
  const [{ count: totalEntries, error: countError }, bgmItems, avatarBundle] = await Promise.all([
    context.supabase.from("log_entries").select("id", { count: "exact", head: true }).eq("log_id", log.id).eq("is_deleted", false),
    getPageBgmItems(context.supabase, id),
    getSpeakerAvatarBundle(admin, id)
  ]);
  if (countError) return NextResponse.json({ error: "외부용 로그 정보를 불러오지 못했습니다." }, { status: 500 });

  const from = offset > 0 ? offset - 1 : 0;
  const to = offset + ENTRY_BATCH_SIZE - 1;
  const { data: entryRows, error: entryError } = await context.supabase.from("log_entries").select(LOG_ENTRY_DTO_COLUMNS)
    .eq("log_id", log.id).eq("is_deleted", false).order("sort_key").order("order_index").range(from, to);
  if (entryError) return NextResponse.json({ error: "로그 메시지를 불러오지 못했습니다." }, { status: 500 });
  const pageEntries = (entryRows ?? []).map((entry) => toLogEntryDto(entry as Record<string, unknown>)) as LogEntry[];
  const previousEntry = offset > 0 ? pageEntries.shift() : undefined;
  const normalizedEntries = normalizeEntryTimestampDisplay(previousEntry ? [previousEntry, ...pageEntries] : pageEntries);
  const normalizedPrevious = previousEntry ? normalizedEntries.shift() : undefined;

  const [{ data: handoutRows, error: handoutError }, { data: profileRows, error: profileError }] = await Promise.all([
    admin.from("handouts").select("id, title, content, order_index").eq("page_id", id).order("order_index").order("created_at"),
    admin.from("page_speaker_profiles").select("id").eq("page_id", id)
  ]);
  if (handoutError || profileError) return NextResponse.json({ error: "부가 자료를 불러오지 못했습니다." }, { status: 500 });
  const handoutIds = (handoutRows ?? []).map((row) => row.id);
  const profileIds = (profileRows ?? []).map((row) => row.id);
  const [{ data: handoutImageRows, error: handoutImageError }, { data: avatarRows, error: avatarError }] = await Promise.all([
    handoutIds.length ? admin.from("handout_images").select("id, handout_id, original_name, mime_type, byte_size, order_index").in("handout_id", handoutIds).eq("is_ready", true).order("order_index").order("created_at") : { data: [] as HandoutImageRow[], error: null },
    profileIds.length ? admin.from("speaker_avatar_variants").select("id, storage_path").in("profile_id", profileIds) : { data: [] as AvatarRow[], error: null }
  ]);
  if (handoutImageError || avatarError) return NextResponse.json({ error: "이미지 정보를 불러오지 못했습니다." }, { status: 500 });

  const assets: ExternalExportAsset[] = [];
  let sessionCardFile: string | null = null;
  if (page.session_card_path) {
    sessionCardFile = `assets/images/session-card.${safeAssetExtension(page.session_card_path, assetExtensionForMime(page.session_card_mime, "img"))}`;
    assets.push({ path: sessionCardFile, url: assetUrl(id, "session-card", "page"), byteSize: page.session_card_size ?? null });
  }

  const imagesByHandout = new Map<string, ExternalExportHandout["images"]>();
  for (const image of (handoutImageRows ?? []) as HandoutImageRow[]) {
    const file = `assets/images/handout-${image.id}.${safeAssetExtension(image.original_name, assetExtensionForMime(image.mime_type, "img"))}`;
    const list = imagesByHandout.get(image.handout_id) ?? [];
    list.push({ file, originalName: image.original_name, mimeType: image.mime_type });
    imagesByHandout.set(image.handout_id, list);
    assets.push({ path: file, url: assetUrl(id, "handout", image.id), byteSize: image.byte_size });
  }
  const handouts: ExternalExportHandout[] = ((handoutRows ?? []) as HandoutRow[]).map((row) => ({ key: `handout-${row.id}`, title: row.title, content: row.content, images: imagesByHandout.get(row.id) ?? [] }));

  const avatarFiles = new Map<string, string>();
  for (const avatar of (avatarRows ?? []) as AvatarRow[]) {
    const file = `assets/images/avatar-${avatar.id}.${safeAssetExtension(avatar.storage_path, "img")}`;
    avatarFiles.set(avatar.id, file);
    assets.push({ path: file, url: assetUrl(id, "avatar", avatar.id), byteSize: null });
  }
  const localAvatars: SpeakerAvatarBundle = {
    ...avatarBundle,
    profiles: avatarBundle.profiles.map((profile) => ({ ...profile, variants: profile.variants.map((variant) => ({ ...variant, imageUrl: avatarFiles.get(variant.id) ?? variant.imageUrl })) }))
  };

  const originalNames = new Map<string, string | null>();
  const uploadAssetIds = [...new Set(bgmItems.filter((item) => item.asset.source_type === "upload").map((item) => item.bgm_asset_id))];
  if (uploadAssetIds.length) {
    const { data } = await admin.from("bgm_assets").select("id, original_filename").in("id", uploadAssetIds);
    for (const asset of data ?? []) originalNames.set(asset.id, asset.original_filename);
  }
  const tracksById = new Map<string, ExternalExportTrack>();
  for (const item of bgmItems) {
    if (tracksById.has(item.bgm_asset_id)) continue;
    const key = `track-${item.bgm_asset_id}`;
    const title = item.asset.canonical_title;
    if (item.asset.source_type === "youtube" && item.asset.youtube_video_id) {
      tracksById.set(item.bgm_asset_id, { key, title, source: { type: "youtube", videoId: item.asset.youtube_video_id } });
    } else if (item.asset.source_type === "upload") {
      const originalFilename = originalNames.get(item.bgm_asset_id) ?? null;
      const file = `assets/bgm/${safeExportName(title, "bgm")}-${item.bgm_asset_id.slice(0, 8)}.mp3`;
      tracksById.set(item.bgm_asset_id, { key, title, source: { type: "upload", file, mimeType: "audio/mpeg", originalFilename } });
      assets.push({ path: file, url: assetUrl(id, "bgm", item.bgm_asset_id), byteSize: item.asset.byte_size ?? null });
    }
  }
  const bgm = bgmItems.filter((item) => tracksById.has(item.bgm_asset_id)).map((item) => ({
    key: `bgm-${item.id}`,
    trackKey: tracksById.get(item.bgm_asset_id)!.key,
    title: displayBgmTitle(item),
    role: item.role,
    entryKey: item.entry_id ? exportEntryKey(item.entry_id) : null,
    sortOrder: item.sort_order
  }));

  const manifest: ExternalLogExportManifest = {
    format: EXTERNAL_LOG_EXPORT_FORMAT,
    version: EXTERNAL_LOG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    page: { title: page.title, platform: log.platform, fontFamily: parseLogFontFamily(page.font_family), overview: page.overview ?? null, sessionCardFile },
    entries: renderExternalEntries(normalizedEntries, localAvatars, normalizedPrevious),
    tracks: [...tracksById.values()],
    bgm,
    handouts
  };
  const loadedThrough = offset + normalizedEntries.length;
  return NextResponse.json({
    filename: `${safeExportName(page.title)}.logcontainer.zip`,
    manifest,
    assets: uniqueAssets(assets),
    totalEntries: totalEntries ?? loadedThrough,
    nextOffset: loadedThrough < (totalEntries ?? loadedThrough) ? loadedThrough : null
  }, { headers: { "Cache-Control": "private, no-store" } });
}
