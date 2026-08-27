import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { requireWorkspaceSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkspacePage } from "@/lib/types";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspaceSession();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("get_workspace_tree", { target_workspace_id: session.workspace.id });

  return (
    <div className="workspace-shell">
      <WorkspaceSidebar workspaceId={session.workspace.id} workspaceName={session.workspace.name} pages={(data ?? []) as WorkspacePage[]} isSiteAdmin={session.profile.is_site_admin} />
      <main className="workspace-main">{children}</main>
    </div>
  );
}
