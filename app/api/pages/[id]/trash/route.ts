import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).maybeSingle();
  if (!log) return NextResponse.json({ entries: [] });
  const { data, error } = await context.supabase.from("log_entries").select("*").eq("log_id", log.id).eq("is_deleted", true).order("deleted_at", { ascending: false });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string") return NextResponse.json({ error: "복원할 블록이 없습니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("set_log_entry_deleted", { target_page_id: id, target_entry_id: body.entryId, should_delete: false });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}
