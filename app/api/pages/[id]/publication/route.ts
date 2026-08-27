import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { createPublicationToken } from "@/lib/publication-token";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log") return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  if (!context.isOriginalOwner) return NextResponse.json({ error: "최초 소유자만 게시 링크를 관리할 수 있습니다." }, { status: 403 });
  const token = createPublicationToken();
  const { data: existing } = await context.supabase.from("publications").select("id").eq("page_id", id).maybeSingle();
  const query = existing
    ? context.supabase.from("publications").update({ token, is_active: true, published_at: new Date().toISOString() }).eq("id", existing.id)
    : context.supabase.from("publications").insert({ page_id: id, token, is_active: true });
  const { data, error } = await query.select("*").single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  if (!context.isOriginalOwner) return NextResponse.json({ error: "최초 소유자만 게시 링크를 관리할 수 있습니다." }, { status: 403 });
  const { data, error } = await context.supabase.from("publications").update({ is_active: false }).eq("page_id", id).select("*").maybeSingle();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data ?? { is_active: false });
}
