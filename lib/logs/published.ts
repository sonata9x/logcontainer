import { unstable_cache } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function getCachedPublishedLog(token: string) {
  return unstable_cache(async () => {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.rpc("get_published_log", { publication_token: token, after_sort_key: null, batch_size: 300 });
    if (error) throw new Error(error.message);
    return data as { page: { id: string; title: string }; publishedAt: string; totalCount: number; entries: Record<string, unknown>[] } | null;
  }, ["published-log", token], { revalidate: 60, tags: ["published-logs"] })();
}
