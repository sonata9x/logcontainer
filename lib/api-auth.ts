import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, Workspace } from "@/lib/types";

type PersonalSessionPayload = { profile: Profile; workspace: Workspace };

export async function getAuthenticatedApiContext() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
  if (!userId) return null;
  const email = typeof data?.claims?.email === "string" ? data.claims.email : null;
  return { supabase, user: { id: userId, email } };
}

export async function getApprovedApiContext() {
  const authenticated = await getAuthenticatedApiContext();
  if (!authenticated) return null;
  const { supabase, user } = authenticated;
  const { data } = await supabase.rpc("get_personal_session_context");
  const session = data as PersonalSessionPayload | null;
  if (!session?.profile || !session.workspace) return null;
  return { supabase, user, isSiteAdmin: Boolean(session.profile.is_site_admin), workspace: session.workspace };
}

export async function getApiWorkspaceContext(workspaceId?: string) {
  const context = await getApprovedApiContext();
  if (!context) return null;
  if (workspaceId && workspaceId !== context.workspace.id) return null;
  return { ...context, workspaceId: context.workspace.id };
}

export async function getApiPageContext(pageId: string) {
  const context = await getApprovedApiContext();
  if (!context) return null;
  const { data } = await context.supabase.rpc("get_resource_api_context", { target_resource_id: pageId });
  const resource = data as { page?: { id: string; page_type: string; original_owner_id: string; deleted_at: string | null }; canEdit?: boolean; canInvite?: boolean; canManage?: boolean; isOriginalOwner?: boolean; canSelfRemove?: boolean } | null;
  return resource?.page ? {
    ...context,
    page: resource.page,
    canEdit: Boolean(resource.canEdit),
    canInvite: Boolean(resource.canInvite),
    canManage: Boolean(resource.canManage),
    isOriginalOwner: Boolean(resource.isOriginalOwner),
    canSelfRemove: Boolean(resource.canSelfRemove)
  } : null;
}
