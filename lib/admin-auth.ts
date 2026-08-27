import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function getSiteAdminApiContext() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from("profiles").select("account_status, is_site_admin").eq("id", user.id).maybeSingle();
  if (profile?.account_status !== "approved" || !profile.is_site_admin) return null;
  return { supabase, admin, user };
}
