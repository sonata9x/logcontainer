import type { SupabaseClient } from "@supabase/supabase-js";
import type { BgmAsset, PageBgmItem } from "@/lib/types";

export const BGM_AUDIO_BUCKET = "bgm-audio";
export const BGM_AUDIO_MAX_BYTES = 25_000_000;
export const BGM_AUDIO_MIME = "audio/mpeg";

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTubeVideoId(value: unknown) {
  if (typeof value !== "string") return null;
  const input = value.trim();
  if (YOUTUBE_ID.test(input)) return input;
  try {
    const url = new URL(input);
    const host = url.hostname.replace(/^www\./, "");
    let candidate: string | null = null;
    if (host === "youtu.be") candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (host === "youtube.com" || host === "m.youtube.com") {
      candidate = url.searchParams.get("v")
        ?? (/^\/(?:shorts|embed)\/([^/?#]+)/.exec(url.pathname)?.[1] ?? null);
    }
    return candidate && YOUTUBE_ID.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function validBgmUpload(mimeType: unknown, byteSize: unknown) {
  return mimeType === BGM_AUDIO_MIME
    && typeof byteSize === "number" && Number.isSafeInteger(byteSize)
    && byteSize > 0 && byteSize <= BGM_AUDIO_MAX_BYTES;
}

export function displayBgmTitle(item: { custom_title?: string | null; asset: Pick<BgmAsset, "canonical_title"> }) {
  return item.custom_title?.trim() || item.asset.canonical_title;
}

export const BGM_ASSET_SELECT = "id, source_type, canonical_title, youtube_video_id, duration_seconds, mime_type, byte_size";

type AssetLike = BgmAsset | BgmAsset[] | null | undefined;
export function oneBgmAsset(value: AssetLike): BgmAsset | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export async function getPageBgmItems(client: SupabaseClient, pageId: string): Promise<PageBgmItem[]> {
  const { data, error } = await client.from("page_bgm_items")
    .select(`id, page_id, bgm_asset_id, role, entry_id, sort_order, custom_title, created_at, asset:bgm_assets(${BGM_ASSET_SELECT})`)
    .eq("page_id", pageId).order("role").order("sort_order").order("created_at");
  if (error) throw new Error("page BGM lookup failed");
  return (data ?? []).map((item) => ({ ...item, asset: oneBgmAsset(item.asset) }))
    .filter((item): item is typeof item & { asset: BgmAsset } => Boolean(item.asset)) as PageBgmItem[];
}

export async function purgeStaleBgmAssets(admin: SupabaseClient) {
  const staleCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const deletedCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: candidates, error } = await admin.from("bgm_assets").select("id, storage_path, is_ready, deleted_at")
    .or(`and(is_ready.eq.false,created_at.lt.${staleCutoff}),and(deleted_at.not.is.null,deleted_at.lt.${deletedCutoff})`).limit(500);
  if (error) throw new Error("stale BGM lookup failed");
  let purged = 0;
  for (const asset of candidates ?? []) {
    const [{ count: library }, { count: playlists }, { count: pages }] = await Promise.all([
      admin.from("bgm_library_items").select("id", { count: "exact", head: true }).eq("bgm_asset_id", asset.id),
      admin.from("bgm_playlist_items").select("id", { count: "exact", head: true }).eq("bgm_asset_id", asset.id),
      admin.from("page_bgm_items").select("id", { count: "exact", head: true }).eq("bgm_asset_id", asset.id)
    ]);
    if ((library ?? 0) + (playlists ?? 0) + (pages ?? 0) > 0) continue;
    if (asset.storage_path) await admin.storage.from(BGM_AUDIO_BUCKET).remove([asset.storage_path]);
    const { error: deleteError } = await admin.from("bgm_assets").delete().eq("id", asset.id);
    if (!deleteError) purged += 1;
  }
  return purged;
}
