import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getApprovedApiContext } from "@/lib/api-auth";

export async function getSiteAdminApiContext() {
  const context = await getApprovedApiContext();
  if (!context?.isSiteAdmin) return null;
  return { ...context, admin: createSupabaseAdminClient() };
}
