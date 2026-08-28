import { NextResponse } from "next/server";
import { getAuthenticatedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(request: Request) {
  const startedAt = performance.now();
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "Workspace가 필요합니다." }, { status: 400 });
  const authAt = performance.now();
  const { data, error } = await context.supabase.rpc("get_workspace_tree", { target_workspace_id: workspaceId });
  const completedAt = performance.now();
  if (error) return databaseErrorResponse(error, "워크스페이스를 불러오지 못했습니다.");
  return NextResponse.json({ pages: data ?? [] }, { headers: { "Server-Timing": `auth;dur=${(authAt - startedAt).toFixed(1)}, tree;dur=${(completedAt - authAt).toFixed(1)}` } });
}
