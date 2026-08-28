import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { LOG_ENTRY_DTO_COLUMNS, toLogEntryDto } from "@/lib/logs/dto";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  if (!context.canEdit) return NextResponse.json({ error: "Guest 뷰어는 삭제 메시지를 볼 수 없습니다." }, { status: 403 });
  const { data, error } = await context.admin.from("log_entries").select(LOG_ENTRY_DTO_COLUMNS)
    .eq("log_id", context.log.id).eq("is_deleted", true).order("deleted_at", { ascending: false }).limit(100);
  return error ? databaseErrorResponse(error, "삭제 메시지를 불러오지 못했습니다.") : NextResponse.json({ entries: (data ?? []).map((entry) => toLogEntryDto(entry as Record<string, unknown>)) });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  if (!context.canEdit) return NextResponse.json({ error: "Guest 뷰어는 메시지를 복원할 수 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string") return NextResponse.json({ error: "복원할 메시지가 없습니다." }, { status: 400 });
  const { data, error } = await context.admin.rpc("set_guest_log_entry_deleted", {
    target_guest_participant_id: context.participant.id, target_page_id: context.page.id,
    target_entry_id: body.entryId, should_delete: false
  });
  return error ? databaseErrorResponse(error, "Guest 메시지를 복원하지 못했습니다.") : NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) });
}
