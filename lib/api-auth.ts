import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function getApiWorkspaceContext(workspaceId?: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase.from("profiles").select("account_status, is_site_admin").eq("id", user.id).maybeSingle();
  if (profile?.account_status !== "approved") return null;
  let query = supabase.from("workspaces").select("id").eq("owner_id", user.id);
  if (workspaceId) query = query.eq("id", workspaceId);
  const { data: workspace } = await query.maybeSingle();
  if (!workspace) return null;

  return { supabase, user, workspaceId: workspace.id as string, isSiteAdmin: Boolean(profile.is_site_admin) };
}

export async function getApiPageContext(pageId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("account_status").eq("id", user.id).maybeSingle();
  if (profile?.account_status !== "approved") return null;
  const { data: page } = await supabase.from("pages").select("id, workspace_id, page_type, original_owner_id, deleted_at").eq("id", pageId).maybeSingle();
  if (!page) return null;
  const { data } = await supabase.rpc("get_resource_permissions", { target_resource_id: pageId });
  const permissions = data as { canView?: boolean; canEdit?: boolean; canInvite?: boolean; canManage?: boolean; isOriginalOwner?: boolean } | null;
  return permissions?.canView ? { supabase, user, workspaceId: page.workspace_id as string, page, canEdit: Boolean(permissions.canEdit), canInvite: Boolean(permissions.canInvite), canManage: Boolean(permissions.canManage), isOriginalOwner: Boolean(permissions.isOriginalOwner) } : null;
}
