import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkspaceRole } from "@/lib/types";

export async function getApiWorkspaceContext(workspaceId?: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  let query = supabase.from("workspace_members").select("workspace_id, role").eq("user_id", user.id).limit(1);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data: membership } = await query.maybeSingle();
  if (!membership) return null;

  return { supabase, user, workspaceId: membership.workspace_id as string, role: membership.role as WorkspaceRole };
}

export async function getApiPageContext(pageId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: page } = await supabase.from("pages").select("id, workspace_id, page_type").eq("id", pageId).maybeSingle();
  if (!page) return null;
  const { data: membership } = await supabase.from("workspace_members").select("role").eq("workspace_id", page.workspace_id).eq("user_id", user.id).maybeSingle();
  return membership ? { supabase, user, workspaceId: page.workspace_id as string, role: membership.role as WorkspaceRole, page } : null;
}
