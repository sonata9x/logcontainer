import { NextResponse } from "next/server";
import { getApiWorkspaceContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? "";
  const context = await getApiWorkspaceContext(workspaceId);
  if (!context) return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  const { data, error } = await context.supabase.from("pages").select("id, page_type, title, icon, deleted_at, purge_after").eq("original_owner_id", context.user.id).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  return error ? databaseErrorResponse(error, "휴지통을 불러오지 못했습니다.") : NextResponse.json({ pages: data ?? [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const context = await getApiWorkspaceContext(body.workspaceId);
  if (!context) return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });

  const pageType = body.pageType === "folder" ? "folder" : "log";
  const parentId = typeof body.parentId === "string" ? body.parentId : null;
  const { data: page, error } = await context.supabase.rpc("create_resource", {
    resource_type: pageType,
    resource_title: pageType === "log" ? "제목 없는 로그" : "새 폴더",
    target_folder_id: parentId
  });
  if (error || !page) return databaseErrorResponse(error, "페이지를 만들지 못했습니다.");
  return NextResponse.json(page, { status: 201 });
}
