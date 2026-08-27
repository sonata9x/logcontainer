import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase/server";
import type { Profile, Workspace } from "./types";

export type WorkspaceSession = {
  user: { id: string };
  workspace: Workspace;
  profile: Profile;
};

export const requireApprovedSession = cache(async function requireApprovedSession() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase.from("profiles").select("id, username, display_name, account_status, is_site_admin, approved_at, approved_by, created_at, updated_at").eq("id", user.id).maybeSingle();
  if (!profile || profile.account_status !== "approved") redirect("/login?account=unavailable");
  return { supabase, user: { id: user.id }, profile: profile as Profile };
});

export const requireWorkspaceSession = cache(async function requireWorkspaceSession(): Promise<WorkspaceSession> {
  const session = await requireApprovedSession();
  const { data: workspace, error } = await session.supabase.from("workspaces").select("id, name, owner_id, created_at, updated_at").eq("owner_id", session.user.id).single();

  if (error || !workspace) {
    throw new Error("개인 워크스페이스를 찾을 수 없습니다.");
  }

  return {
    user: session.user,
    workspace: workspace as Workspace,
    profile: session.profile
  };
});
