import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { toLogEntryDto } from "@/lib/logs/dto";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).maybeSingle();
  if (!log) return NextResponse.json({ entries: [] });
  const { data, error } = await context.supabase.from("log_entries").select("id, speaker_name, content, deleted_at").eq("log_id", log.id).eq("is_deleted", true).order("deleted_at", { ascending: false });
  return error ? databaseErrorResponse(error, "로그 휴지통을 불러오지 못했습니다.") : NextResponse.json({ entries: data ?? [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string") return NextResponse.json({ error: "복원할 블록이 없습니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("set_log_entry_deleted_v3", { target_page_id: id, target_entry_id: body.entryId, should_delete: false });
  return error ? databaseErrorResponse(error, "로그 블록을 복원하지 못했습니다.") : NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.isOriginalOwner) return NextResponse.json({ error: "최초 소유자만 로그 휴지통을 비울 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "EMPTY_TRASH") return NextResponse.json({ error: "확인이 필요합니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("empty_log_entry_trash", { target_page_id: id });
  return error ? databaseErrorResponse(error, "로그 휴지통을 비우지 못했습니다.") : NextResponse.json({ removed: data ?? 0 });
}
