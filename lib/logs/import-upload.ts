import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MAX_STAGED_ROLL20_SOURCE_SIZE, ROLL20_IMPORT_STAGING_BUCKET } from "@/lib/logs/import-limits";

export const STAGED_IMPORT_TTL_MS = 2 * 60 * 60 * 1000;

type UploadIntent = {
  id: string;
  page_id: string;
  log_id: string;
  owner_id: string;
  storage_path: string;
  expected_size_bytes: number;
  expires_at: string;
};

function storageUploadOrigin() {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!configured) throw new Error("Supabase URL is required");
  const url = new URL(configured);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectRef = url.hostname.slice(0, -".supabase.co".length);
    return `${url.protocol}//${projectRef}.storage.supabase.co`;
  }
  return url.origin;
}

export function isImportUploadId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function createImportUploadTarget(input: { pageId: string; logId: string; ownerId: string; sizeBytes: number }) {
  const admin = createSupabaseAdminClient();
  const id = randomUUID();
  const storagePath = `pending/${input.ownerId}/${input.pageId}/${id}.html`;
  const expiresAt = new Date(Date.now() + STAGED_IMPORT_TTL_MS).toISOString();
  const { error: intentError } = await admin.from("log_import_uploads").insert({
    id,
    page_id: input.pageId,
    log_id: input.logId,
    owner_id: input.ownerId,
    storage_path: storagePath,
    expected_size_bytes: input.sizeBytes,
    expires_at: expiresAt
  });
  if (intentError) throw new Error("import upload intent creation failed");

  return { uploadId: id, storagePath, storageOrigin: storageUploadOrigin(), expiresAt };
}

export async function consumeImportUpload(input: { uploadId: string; pageId: string; ownerId: string }) {
  const admin = createSupabaseAdminClient();
  const claimedAt = new Date().toISOString();
  const { data, error } = await admin.from("log_import_uploads")
    .update({ consumed_at: claimedAt })
    .eq("id", input.uploadId)
    .eq("page_id", input.pageId)
    .eq("owner_id", input.ownerId)
    .is("consumed_at", null)
    .gt("expires_at", claimedAt)
    .select("id, page_id, log_id, owner_id, storage_path, expected_size_bytes, expires_at")
    .maybeSingle();
  if (error) throw new Error("import upload claim failed");
  const intent = data as UploadIntent | null;
  if (!intent) return null;

  try {
    const { data: source, error: downloadError } = await admin.storage.from(ROLL20_IMPORT_STAGING_BUCKET).download(intent.storage_path);
    if (downloadError || !source) throw new Error("staged import download failed");
    const payload = Buffer.from(await source.arrayBuffer());
    if (payload.byteLength !== Number(intent.expected_size_bytes) || payload.byteLength > MAX_STAGED_ROLL20_SOURCE_SIZE) {
      throw new Error("staged import size mismatch");
    }
    return { payload, logId: intent.log_id };
  } finally {
    await Promise.allSettled([
      admin.storage.from(ROLL20_IMPORT_STAGING_BUCKET).remove([intent.storage_path]),
      admin.from("log_import_uploads").delete().eq("id", intent.id)
    ]);
  }
}

export async function cancelImportUpload(input: { uploadId: string; pageId: string; ownerId: string }) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("log_import_uploads")
    .select("id, storage_path")
    .eq("id", input.uploadId)
    .eq("page_id", input.pageId)
    .eq("owner_id", input.ownerId)
    .maybeSingle();
  if (error) throw new Error("import upload cancellation failed");
  if (!data?.storage_path) return;
  const { error: removeError } = await admin.storage.from(ROLL20_IMPORT_STAGING_BUCKET).remove([data.storage_path]);
  if (removeError) throw new Error("import upload object cancellation failed");
  const { error: deleteError } = await admin.from("log_import_uploads").delete().eq("id", data.id);
  if (deleteError) throw new Error("import upload metadata cancellation failed");
}

export async function purgeExpiredImportUploads() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from("log_import_uploads")
    .select("id, storage_path")
    .lt("expires_at", new Date().toISOString())
    .limit(500);
  if (error) throw new Error("expired import upload lookup failed");
  if (!data?.length) return 0;
  const { error: removeError } = await admin.storage.from(ROLL20_IMPORT_STAGING_BUCKET).remove(data.map((item) => item.storage_path));
  if (removeError) throw new Error("expired import upload cleanup failed");
  const { error: deleteError } = await admin.from("log_import_uploads").delete().in("id", data.map((item) => item.id));
  if (deleteError) throw new Error("expired import upload metadata cleanup failed");
  return data.length;
}
