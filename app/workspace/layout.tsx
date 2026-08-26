import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { requireWorkspaceSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkspacePage } from "@/lib/types";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspaceSession();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("pages").select("*")
    .eq("workspace_id", session.workspace.id).eq("is_archived", false)
    .order("order_index").order("created_at");

  return (
    <div className="workspace-shell">
      <WorkspaceSidebar workspaceId={session.workspace.id} workspaceName={session.workspace.name} pages={(data ?? []) as WorkspacePage[]} canInvite={session.role === "owner"} />
      <main className="workspace-main">{children}</main>
    </div>
  );
}
