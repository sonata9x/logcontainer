import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { LOG_ENTRY_DTO_COLUMNS, toLogEntryDto } from "@/lib/logs/dto";
import { applyCorrections, defaultCorrectionSettings } from "@/lib/logs/corrections";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.admin.from("log_entries").select(LOG_ENTRY_DTO_COLUMNS)
    .eq("log_id", context.log.id).eq("is_deleted", false).order("sort_key");
  if (error) return databaseErrorResponse(error, "TXT를 만들지 못했습니다.");
  const text = applyCorrections((data ?? []).map((entry) => toLogEntryDto(entry as Record<string, unknown>)), defaultCorrectionSettings);
  const filename = `${context.page.title.replace(/[\\/:*?"<>|]/g, "_") || "log"}.txt`;
  return new NextResponse(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "no-store" } });
}
