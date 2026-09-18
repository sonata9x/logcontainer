import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKETS = new Set(["session-cards", "handout-images", "roll20-source-archives", "log-generation-archives", "roll20-import-staging"]);

export async function drainStorageDeletionQueue(admin: SupabaseClient) {
  const { data, error } = await admin.from("storage_deletion_queue").select("id, bucket, storage_path").order("created_at").order("id").limit(100);
  if (error) throw new Error("storage deletion queue lookup failed");
  let removed = 0;
  for (const item of data ?? []) {
    if (!BUCKETS.has(item.bucket)) throw new Error("invalid cleanup bucket");
    const { error: storageError } = await admin.storage.from(item.bucket).remove([item.storage_path]);
    if (storageError) continue;
    const { error: rowError } = await admin.from("storage_deletion_queue").delete().eq("id", item.id);
    if (!rowError) removed++;
  }
  return removed;
}
