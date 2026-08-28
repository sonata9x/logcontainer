import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { LOG_ENTRY_DTO_COLUMNS, toLogEntryDto } from "@/lib/logs/dto";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const after = Number(new URL(request.url).searchParams.get("after"));
  let query = context.admin.from("log_entries").select(LOG_ENTRY_DTO_COLUMNS)
    .eq("log_id", context.log.id).eq("is_deleted", false).order("sort_key").limit(50);
  if (Number.isFinite(after)) query = query.gt("sort_key", after);
  const [{ data, error }, { data: latestEvent }] = await Promise.all([
    query,
    context.admin.from("log_change_events").select("id").eq("log_id", context.log.id).order("id", { ascending: false }).limit(1).maybeSingle()
  ]);
  return error ? databaseErrorResponse(error, "Guest 로그를 불러오지 못했습니다.") : NextResponse.json({
    page: { id: context.page.id, title: context.page.title },
    participant: { id: context.participant.id, nickname: context.participant.nickname, accessLevel: context.participant.access_level },
    entries: (data ?? []).map((entry) => toLogEntryDto(entry as Record<string, unknown>)),
    totalCount: context.log.visible_entry_count, importReport: context.log.import_report,
    log: { platform: context.log.platform, updatedAt: context.log.updated_at }, canEdit: context.canEdit,
    eventCursor: latestEvent?.id ?? 0
  }, { headers: { "Cache-Control": "no-store" } });
}
