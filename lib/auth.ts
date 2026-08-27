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
  const startedAt = performance.now();
  const supabase = await createSupabaseServerClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  const verifiedAt = performance.now();

  if (!userId) {
    redirect("/login");
  }

  const { data } = await supabase.rpc("get_personal_session_context");
  const completedAt = performance.now();
  const session = data as PersonalSessionPayload | null;
  if (!session?.profile || !session.workspace) redirect("/login?account=unavailable");
  console.info(JSON.stringify({ event: "workspace_session_timing", verifyMs: Math.round(verifiedAt - startedAt), dbMs: Math.round(completedAt - verifiedAt), totalMs: Math.round(completedAt - startedAt) }));
  return { supabase, user: { id: userId }, profile: session.profile, workspace: session.workspace };
});

export const requireWorkspaceSession = cache(async function requireWorkspaceSession(): Promise<WorkspaceSession> {
  const session = await requireApprovedSession();

  return {
    user: session.user,
    workspace: session.workspace,
    profile: session.profile
  };
});
