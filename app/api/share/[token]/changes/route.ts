import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const after = Math.max(0, Number(new URL(request.url).searchParams.get("after")) || 0);
  const { data, error } = await context.admin.from("log_change_events")
    .select("id, entry_id, event_type, updated_at").eq("log_id", context.log.id)
    .gt("id", after).order("id").limit(100);
  return error ? databaseErrorResponse(error, "Guest 변경 내역을 불러오지 못했습니다.") : NextResponse.json({ events: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
