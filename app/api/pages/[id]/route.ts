import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
    const { data, error } = await context.supabase.rpc("update_resource_title", { target_resource_id: id, next_title: title });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
  }
  if (body.isArchived === true) {
    const rpc = context.isOriginalOwner ? "trash_resource" : "self_remove_resource";
    const { data, error } = await context.supabase.rpc(rpc, { target_resource_id: id });
    return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
  }
  return NextResponse.json({ error: "변경할 값이 없습니다." }, { status: 400 });
}
