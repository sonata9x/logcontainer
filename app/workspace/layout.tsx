import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { requireWorkspaceSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkspacePage } from "@/lib/types";

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const startedAt = performance.now();
  const session = await requireWorkspaceSession();
  const sessionAt = performance.now();
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.rpc("get_workspace_tree", { target_workspace_id: session.workspace.id });
  const completedAt = performance.now();
  console.info(JSON.stringify({ event: "workspace_layout_timing", sessionMs: Math.round(sessionAt - startedAt), treeMs: Math.round(completedAt - sessionAt), resourceCount: data?.length ?? 0, totalMs: Math.round(completedAt - startedAt) }));

  return (
    <div className="workspace-shell">
      <WorkspaceSidebar workspaceId={session.workspace.id} workspaceName={session.workspace.name} nickname={session.profile.display_name ?? session.profile.username} pages={(data ?? []) as WorkspacePage[]} isSiteAdmin={session.profile.is_site_admin} />
      <main className="workspace-main">{children}</main>
    </div>
  );
}
