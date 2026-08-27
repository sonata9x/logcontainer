import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "./supabase/server";
import type { Profile, Workspace } from "./types";

export type WorkspaceSession = {
  user: { id: string };
  workspace: Workspace;
  profile: Profile;
};

type PersonalSessionPayload = { profile: Profile; workspace: Workspace };

export const requireApprovedSession = cache(async function requireApprovedSession() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase.rpc("get_personal_session_context");
  const session = data as PersonalSessionPayload | null;
  if (!session?.profile || !session.workspace) redirect("/login?account=unavailable");
  return { supabase, user: { id: user.id }, profile: session.profile, workspace: session.workspace };
});

export const requireWorkspaceSession = cache(async function requireWorkspaceSession(): Promise<WorkspaceSession> {
  const session = await requireApprovedSession();

  return {
    user: session.user,
    workspace: session.workspace,
    profile: session.profile
  };
});
