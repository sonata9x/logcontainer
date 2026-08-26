import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";

const booleanKeys = ["remove_html_tags", "normalize_ellipsis", "normalize_quotes", "speaker_tab_format", "clean_blank_lines", "mark_handout_position"] as const;
const textKeys = ["custom_quote_open", "custom_quote_close", "custom_ellipsis", "custom_handout_icon"] as const;

async function findLog(context: NonNullable<Awaited<ReturnType<typeof getApiPageContext>>>, pageId: string) {
  const { data } = await context.supabase.from("logs").select("id").eq("page_id", pageId).maybeSingle();
  return data;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const log = await findLog(context, id);
  const { data, error } = await context.supabase.from("correction_settings").select("*").eq("log_id", log!.id).maybeSingle();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ settings: data });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const updates: Record<string, boolean | string> = {};
  booleanKeys.forEach((key) => { if (typeof body[key] === "boolean") updates[key] = body[key]; });
  textKeys.forEach((key) => { if (typeof body[key] === "string") updates[key] = body[key].slice(0, 8); });
  const log = await findLog(context, id);
  const { data, error } = await context.supabase.from("correction_settings").update(updates).eq("log_id", log!.id).select("*").single();
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}
