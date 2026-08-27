import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "folder") return NextResponse.json({ error: "폴더 편집 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { data, error } = await context.supabase.rpc("remove_folder_item", { target_folder_id: id, target_child_resource_id: body.childId });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ removed: data });
}
