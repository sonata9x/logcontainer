import { createHash } from "node:crypto";
import type { CanonicalImportResult } from "@/lib/logs/import/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const LOG_AVATAR_ASSET_BUCKET = "log-avatar-assets";

type UploadedAvatarAsset = { bucket: string; path: string };

function embeddedImage(value: string) {
  const match = value.match(/^data:image\/(png|jpe?g|gif|webp);base64,([a-z0-9+/=\r\n]+)$/i);
  if (!match) return null;
  const subtype = match[1].toLowerCase();
  const extension = subtype === "jpeg" || subtype === "jpg" ? "jpg" : subtype;
  const contentType = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
  const payload = Buffer.from(match[2].replace(/[\r\n]/g, ""), "base64");
  if (!payload.byteLength || payload.byteLength > 5_000_000) return null;
  return { extension, contentType, payload };
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

export async function persistTakoyakiAvatarAssets(imported: CanonicalImportResult, logId: string, importId: string): Promise<UploadedAvatarAsset[]> {
  if (imported.platform !== "takoyaki-box") return [];
  const embeddedUrls = [...new Set(imported.documents.flatMap((document) => {
    const avatarUrl = document.speaker?.avatarUrl;
    return avatarUrl?.startsWith("data:image/") ? [avatarUrl] : [];
  }))];
  if (!embeddedUrls.length) return [];

  const admin = createSupabaseAdminClient();
  const replacements = new Map<string, string>();
  const outcomes = await mapWithConcurrency(embeddedUrls, 5, async (dataUrl) => {
    try {
      const image = embeddedImage(dataUrl);
      if (!image) throw new Error("invalid embedded Takoyaki avatar image");
      const hash = createHash("sha256").update(image.payload).digest("hex");
      const path = `${logId}/${importId}/${hash}.${image.extension}`;
      const { error } = await admin.storage.from(LOG_AVATAR_ASSET_BUCKET).upload(path, image.payload, {
        contentType: image.contentType,
        cacheControl: "31536000",
        upsert: false
      });
      if (error) throw new Error(`avatar upload failed: ${error.message}`);
      const { data } = admin.storage.from(LOG_AVATAR_ASSET_BUCKET).getPublicUrl(path);
      return { ok: true as const, dataUrl, publicUrl: data.publicUrl, uploaded: { bucket: LOG_AVATAR_ASSET_BUCKET, path } };
    } catch (error) {
      return { ok: false as const, error };
    }
  });
  const uploaded = outcomes.flatMap((outcome) => outcome.ok ? [outcome.uploaded] : []);
  const failure = outcomes.find((outcome) => !outcome.ok);
  if (failure && !failure.ok) {
    await Promise.allSettled(uploaded.map(({ path }) => admin.storage.from(LOG_AVATAR_ASSET_BUCKET).remove([path])));
    throw failure.error;
  }
  for (const outcome of outcomes) if (outcome.ok) replacements.set(outcome.dataUrl, outcome.publicUrl);

  for (const document of [...imported.documents, ...imported.entries.map((entry) => entry.document)]) {
    const avatarUrl = document.speaker?.avatarUrl;
    if (avatarUrl && replacements.has(avatarUrl)) document.speaker!.avatarUrl = replacements.get(avatarUrl)!;
  }
  return uploaded;
}
