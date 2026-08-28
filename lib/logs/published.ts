import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function getPublishedLog(token: string, afterSortKey: number | null = null) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_published_log", { publication_token: token, after_sort_key: afterSortKey, batch_size: 50 });
  if (error) throw new Error("published log lookup failed");
  return data as { page: { id: string; title: string }; publishedAt: string; totalCount: number; entries: Record<string, unknown>[] } | null;
}
