import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const ROLL20_SOURCE_BUCKET = "roll20-source-archives";
export const LOG_GENERATION_BUCKET = "log-generation-archives";

export function gzipArchive(input: string | Buffer) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  const compressed = gzipSync(raw, { level: 9 });
  return {
    raw,
    compressed,
    sha256: createHash("sha256").update(raw).digest("hex"),
    sourceSizeBytes: raw.byteLength,
    compressedSizeBytes: compressed.byteLength
  };
}

export function gunzipArchive(input: ArrayBuffer | Buffer) {
  return gunzipSync(Buffer.isBuffer(input) ? input : Buffer.from(input));
}

export async function uploadPrivateArchive(bucket: string, path: string, payload: Buffer, contentType: string) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.storage.from(bucket).upload(path, payload, {
    contentType,
    upsert: false,
    cacheControl: "private, no-store"
  });
  if (error) throw new Error(`archive upload failed: ${error.message}`);
}

export async function removePrivateArchives(objects: Array<{ bucket: string; path: string }>) {
  const admin = createSupabaseAdminClient();
  await Promise.allSettled(objects.map(({ bucket, path }) => admin.storage.from(bucket).remove([path])));
}

export async function downloadPrivateArchive(bucket: string, path: string) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`archive download failed: ${error?.message ?? "not found"}`);
  return Buffer.from(await data.arrayBuffer());
}
