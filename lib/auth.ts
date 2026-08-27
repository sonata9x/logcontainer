import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import type { Profile, Workspace } from "./types";

export type WorkspaceSession = {
  user: { id: string };
  workspace: Workspace;
  profile: Profile;
};

export async function requireWorkspaceSession(): Promise<WorkspaceSession> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile || profile.account_status !== "approved") redirect("/login?account=unavailable");
  const { data: workspace, error } = await supabase.from("workspaces").select("*").eq("owner_id", user.id).single();

  if (error || !workspace) {
    throw new Error("개인 워크스페이스를 찾을 수 없습니다.");
  }

  return {
    user: { id: user.id },
    workspace: workspace as Workspace,
    profile: profile as Profile
  };
}
