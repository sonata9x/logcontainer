import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const title = body.title.trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
    updates.title = title;
  }
  if (typeof body.isArchived === "boolean") updates.is_archived = body.isArchived;
  if (!Object.keys(updates).length) return NextResponse.json({ error: "변경할 값이 없습니다." }, { status: 400 });
  const { data, error } = await context.supabase.from("pages").update(updates).eq("id", id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (body.isArchived === true) await context.supabase.from("publications").update({ is_active: false }).eq("page_id", id);
  return NextResponse.json(data);
}
