import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import type { Workspace, WorkspaceRole } from "./types";

export type WorkspaceSession = {
  user: { id: string };
  workspace: Workspace;
  role: WorkspaceRole;
};

export async function requireWorkspaceSession(): Promise<WorkspaceSession> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: membership, error } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces(*)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !membership?.workspace) {
    throw new Error("워크스페이스 멤버십을 찾을 수 없습니다.");
  }

  return {
    user: { id: user.id },
    workspace: membership.workspace as unknown as Workspace,
    role: membership.role as WorkspaceRole
  };
}
