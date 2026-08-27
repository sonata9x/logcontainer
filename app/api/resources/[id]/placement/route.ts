import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "리소스를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const parentId = typeof body.parentId === "string" && body.parentId ? body.parentId : null;
  const { data, error } = await context.supabase.rpc("move_workspace_item", { target_resource_id: id, target_parent_local_resource_id: parentId, target_order: Number.isInteger(body.orderIndex) ? body.orderIndex : 0 });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}
