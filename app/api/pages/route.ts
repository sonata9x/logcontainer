import { NextResponse } from "next/server";
import { getApiWorkspaceContext } from "@/lib/api-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const context = await getApiWorkspaceContext(workspaceId);
  if (!context) return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  const { data, error } = await context.supabase.from("pages").select("*").eq("workspace_id", workspaceId).eq("is_archived", true).order("updated_at", { ascending: false });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ pages: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const context = await getApiWorkspaceContext(body.workspaceId);
  if (!context) return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });

  const pageType = body.pageType === "folder" ? "folder" : "log";
  const parentId = typeof body.parentId === "string" ? body.parentId : null;
  if (parentId) {
    const { data: parent } = await context.supabase.from("pages").select("id").eq("id", parentId).eq("workspace_id", context.workspaceId).eq("page_type", "folder").maybeSingle();
    if (!parent) return NextResponse.json({ error: "상위 폴더를 찾을 수 없습니다." }, { status: 400 });
  }
  const { data: page, error } = await context.supabase.from("pages").insert({
    workspace_id: context.workspaceId,
    parent_id: parentId,
    page_type: pageType,
    title: pageType === "log" ? "제목 없는 로그" : "새 폴더",
    created_by: context.user.id
  }).select("*").single();
  if (error || !page) return NextResponse.json({ error: error?.message ?? "페이지 생성 실패" }, { status: 400 });

  if (pageType === "log") {
    const { error: logError } = await context.supabase.from("logs").insert({ page_id: page.id });
    if (logError) {
      await context.supabase.from("pages").delete().eq("id", page.id);
      return NextResponse.json({ error: logError.message }, { status: 400 });
    }
  }
  return NextResponse.json(page, { status: 201 });
}
