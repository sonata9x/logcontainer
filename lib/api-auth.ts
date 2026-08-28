import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Profile, ResourcePermissions, ResourceRole, Workspace } from "@/lib/types";

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
  const resource = data as {
    page?: { id: string; page_type: string; original_owner_id: string; deleted_at: string | null };
    permissions?: Partial<ResourcePermissions> & { role?: ResourceRole };
    canEdit?: boolean;
    canInvite?: boolean;
    canManage?: boolean;
    isOriginalOwner?: boolean;
    canSelfRemove?: boolean;
  } | null;
  const role = resource?.permissions?.role
    ?? (resource?.isOriginalOwner ? "owner" : resource?.canInvite ? "admin" : resource?.canEdit ? "editor" : "viewer");
  const permissions: ResourcePermissions = {
    role,
    canView: resource?.permissions?.canView ?? true,
    canEdit: resource?.permissions?.canEdit ?? Boolean(resource?.canEdit),
    canManageShares: resource?.permissions?.canManageShares ?? Boolean(resource?.canInvite),
    canManageGuestLink: resource?.permissions?.canManageGuestLink ?? false,
    canPublish: resource?.permissions?.canPublish ?? Boolean(resource?.isOriginalOwner),
    canReimport: resource?.permissions?.canReimport ?? Boolean(resource?.isOriginalOwner),
    canRestoreOriginal: resource?.permissions?.canRestoreOriginal ?? Boolean(resource?.isOriginalOwner),
    canTrashResource: resource?.permissions?.canTrashResource ?? Boolean(resource?.isOriginalOwner),
    canSelfRemove: resource?.permissions?.canSelfRemove ?? Boolean(resource?.canSelfRemove)
  };
  return resource?.page ? {
    ...context,
    page: resource.page,
    permissions,
    resourceRole: permissions.role,
    canEdit: permissions.canEdit,
    canInvite: permissions.canManageShares,
    canManageShares: permissions.canManageShares,
    canManageGuestLink: permissions.canManageGuestLink,
    canPublish: permissions.canPublish,
    canReimport: permissions.canReimport,
    canRestoreOriginal: permissions.canRestoreOriginal,
    canTrashResource: permissions.canTrashResource,
    canManage: Boolean(resource.canManage),
    isOriginalOwner: permissions.role === "owner",
    canSelfRemove: permissions.canSelfRemove
  } : null;
}
