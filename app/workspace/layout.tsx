import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import { WorkspaceAppearance } from "@/components/WorkspaceAppearance";
import { fontFamilyStack, parseLogFontFamily } from "@/lib/fonts";
import { requireWorkspaceSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { WorkspacePage } from "@/lib/types";
import type { CSSProperties } from "react";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const session = await requireWorkspaceSession();
  return { title: session.workspace.name?.trim() || "TRPG Workspace" };
}

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const startedAt = performance.now();
  const session = await requireWorkspaceSession();
  const sessionAt = performance.now();
  const supabase = await createSupabaseServerClient();
  const [{ data }, { data: preferences }] = await Promise.all([
    supabase.rpc("get_workspace_tree", { target_workspace_id: session.workspace.id }),
    supabase.from("user_preferences").select("accent_color, system_font_family").eq("user_id", session.profile.id).maybeSingle()
  ]);
  const completedAt = performance.now();
  console.info(JSON.stringify({ event: "workspace_layout_timing", sessionMs: Math.round(sessionAt - startedAt), treeMs: Math.round(completedAt - sessionAt), resourceCount: data?.length ?? 0, totalMs: Math.round(completedAt - startedAt) }));

  return (
    <div className="workspace-shell" style={{ "--accent": preferences?.accent_color ?? "#4F6BED", "--system-font-family": fontFamilyStack(preferences?.system_font_family) } as CSSProperties}>
      <WorkspaceAppearance initialSystemFont={parseLogFontFamily(preferences?.system_font_family)} initialAccentColor={preferences?.accent_color ?? "#4F6BED"}>
        <WorkspaceSidebar workspaceId={session.workspace.id} workspaceName={session.workspace.name} nickname={session.profile.display_name ?? session.profile.username} accentColor={preferences?.accent_color ?? "#4F6BED"} pages={(data ?? []) as WorkspacePage[]} isSiteAdmin={session.profile.is_site_admin} />
        <main className="workspace-main">{children}</main>
      </WorkspaceAppearance>
    </div>
  );
}
