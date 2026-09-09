import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { serializeHandouts } from "@/lib/handouts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SELECT = "id, page_id, title, content, order_index, created_at, updated_at";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log") return NextResponse.json({ error: "문서를 찾지 못했습니다." }, { status: 404 });
  const { data, error } = await context.supabase.from("handouts").select(SELECT).eq("page_id", id).order("order_index").order("created_at");
  if (error) return databaseErrorResponse(error, "핸드아웃을 불러오지 못했습니다.");
  try {
    return NextResponse.json({ handouts: await serializeHandouts(createSupabaseAdminClient(), data ?? []) });
  } catch {
    return NextResponse.json({ error: "핸드아웃 이미지를 불러오지 못했습니다." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "핸드아웃 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const content = typeof body.content === "string" ? body.content.slice(0, 200_000) : "";
  if (!title) return NextResponse.json({ error: "핸드아웃 제목을 입력해주세요." }, { status: 400 });
  const { data: last } = await context.supabase.from("handouts").select("order_index").eq("page_id", id).order("order_index", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await context.supabase.from("handouts").insert({ page_id: id, title, content, order_index: (last?.order_index ?? -1) + 1, created_by: context.user.id }).select(SELECT).single();
  return error ? databaseErrorResponse(error, "핸드아웃을 추가하지 못했습니다.") : NextResponse.json({ handout: { ...data, images: [] } }, { status: 201 });
}
