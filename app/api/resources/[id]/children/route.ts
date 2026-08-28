import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "folder") return NextResponse.json({ error: "폴더 편집 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.childId !== "string") return NextResponse.json({ error: "이동할 리소스가 없습니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("insert_folder_item", {
    target_folder_id: id,
    target_child_resource_id: body.childId,
    target_order: Number.isInteger(body.orderIndex) ? body.orderIndex : 0
  });
  return error ? databaseErrorResponse(error, "폴더에 리소스를 넣지 못했습니다.") : NextResponse.json(data, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "folder") return NextResponse.json({ error: "폴더 편집 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { data, error } = await context.supabase.rpc("remove_folder_item", { target_folder_id: id, target_child_resource_id: body.childId });
  return error ? databaseErrorResponse(error, "폴더에서 리소스를 제거하지 못했습니다.") : NextResponse.json({ removed: data });
}
