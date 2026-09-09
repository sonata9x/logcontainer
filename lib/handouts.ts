import type { SupabaseClient } from "@supabase/supabase-js";
import type { Handout } from "@/lib/types";

export const HANDOUT_IMAGE_BUCKET = "handout-images";
export const HANDOUT_IMAGE_MAX_BYTES = 10_000_000;
export const HANDOUT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

type HandoutRow = {
  id: string;
  page_id: string;
  title: string;
  content: string;
  order_index: number;
  created_at: string;
  updated_at: string;
};

type HandoutImageRow = {
  id: string;
  handout_id: string;
  storage_path: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  order_index: number;
};

type StoredHandoutImageRow = { id: string; storage_path: string };

export function validHandoutImage(mimeType: unknown, byteSize: unknown) {
  return typeof mimeType === "string" && HANDOUT_IMAGE_TYPES.has(mimeType)
    && typeof byteSize === "number" && Number.isSafeInteger(byteSize)
    && byteSize > 0 && byteSize <= HANDOUT_IMAGE_MAX_BYTES;
}

export function handoutImageExtension(mimeType: string) {
  return ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[mimeType] ?? "bin";
}

export async function serializeHandouts(admin: SupabaseClient, rows: HandoutRow[]): Promise<Handout[]> {
  if (!rows.length) return [];
  const { data: imageRows, error } = await admin.from("handout_images")
    .select("id, handout_id, storage_path, original_name, mime_type, byte_size, order_index")
    .in("handout_id", rows.map((row) => row.id)).eq("is_ready", true)
    .order("order_index").order("created_at");
  if (error) throw new Error("handout image lookup failed");
  const imagesByHandout = new Map<string, Handout["images"]>();
  await Promise.all(((imageRows ?? []) as HandoutImageRow[]).map(async (image) => {
    const { data } = await admin.storage.from(HANDOUT_IMAGE_BUCKET).createSignedUrl(image.storage_path, 60 * 60);
    if (!data?.signedUrl) return;
    const list = imagesByHandout.get(image.handout_id) ?? [];
    list.push({ id: image.id, original_name: image.original_name, mime_type: image.mime_type, byte_size: image.byte_size, order_index: image.order_index, url: data.signedUrl });
    imagesByHandout.set(image.handout_id, list);
  }));
  return rows.map((row) => ({ ...row, images: (imagesByHandout.get(row.id) ?? []).sort((left, right) => left.order_index - right.order_index) }));
}

async function removeStoredImages(admin: SupabaseClient, rows: StoredHandoutImageRow[]) {
  if (!rows.length) return 0;
  const { error } = await admin.storage.from(HANDOUT_IMAGE_BUCKET).remove(rows.map((row) => row.storage_path));
  if (error) throw new Error("handout image storage cleanup failed");
  return rows.length;
}

export async function purgeExpiredResourceHandoutImages(admin: SupabaseClient) {
  const now = new Date().toISOString();
  const { data: pages, error: pageError } = await admin.from("pages")
    .select("id").not("deleted_at", "is", null).lte("purge_after", now).limit(500);
  if (pageError) throw new Error("expired handout page lookup failed");
  const pageIds = (pages ?? []).map((page) => page.id);
  if (!pageIds.length) return 0;
  const { data: handouts, error: handoutError } = await admin.from("handouts").select("id").in("page_id", pageIds);
  if (handoutError) throw new Error("expired handout lookup failed");
  const handoutIds = (handouts ?? []).map((handout) => handout.id);
  if (!handoutIds.length) return 0;
  const { data: images, error: imageError } = await admin.from("handout_images")
    .select("id, storage_path").in("handout_id", handoutIds);
  if (imageError) throw new Error("expired handout image lookup failed");
  return removeStoredImages(admin, (images ?? []) as StoredHandoutImageRow[]);
}

export async function purgeStaleHandoutUploads(admin: SupabaseClient) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin.from("handout_images")
    .select("id, storage_path").eq("is_ready", false).lt("created_at", cutoff).limit(500);
  if (error) throw new Error("stale handout image lookup failed");
  const rows = (data ?? []) as StoredHandoutImageRow[];
  await removeStoredImages(admin, rows);
  if (!rows.length) return 0;
  const { error: deleteError } = await admin.from("handout_images")
    .delete().in("id", rows.map((row) => row.id)).eq("is_ready", false);
  if (deleteError) throw new Error("stale handout image cleanup failed");
  return rows.length;
}
