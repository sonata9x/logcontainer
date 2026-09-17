import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { parseLogFontFamily, serializePageExtras } from "@/lib/page-extras";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SELECT = "overview, font_family, session_card_path, session_card_mime, session_card_size";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log") return NextResponse.json({ error: "로그를 찾지 못했습니다." }, { status: 404 });
  const { data, error } = await context.supabase.from("pages").select(SELECT).eq("id", id).single();
  if (error) return databaseErrorResponse(error, "페이지 정보를 불러오지 못했습니다.");
  return NextResponse.json({ extras: await serializePageExtras(createSupabaseAdminClient(), data) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "페이지 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const update: { overview?: string | null; font_family?: string } = {};
  if (Object.hasOwn(body, "overview")) {
    if (body.overview !== null && typeof body.overview !== "string") return NextResponse.json({ error: "개요 형식이 올바르지 않습니다." }, { status: 400 });
    const overview = typeof body.overview === "string" ? body.overview.slice(0, 20_000).trim() : null;
    update.overview = overview || null;
  }
  if (Object.hasOwn(body, "fontFamily")) update.font_family = parseLogFontFamily(body.fontFamily);
  if (!Object.keys(update).length) return NextResponse.json({ error: "변경할 값이 없습니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("update_page_extras", { target_page_id: id, changes: update });
  if (error) return databaseErrorResponse(error, "페이지 정보를 저장하지 못했습니다.");
  return NextResponse.json({ extras: await serializePageExtras(createSupabaseAdminClient(), data) });
}
