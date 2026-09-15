import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { LOG_ENTRY_DTO_COLUMNS, toLogEntryDto } from "@/lib/logs/dto";
import { applyCorrections, createReviewExport, parseCorrectionSettings, parseExportRequest } from "@/lib/logs/corrections";
import { fetchAllByRange } from "@/lib/logs/export-all";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const legacySettings = parseCorrectionSettings(body);
  const exportRequest = parseExportRequest(body) ?? (legacySettings ? { preset: "custom" as const, settings: legacySettings } : null);
  if (!exportRequest) return NextResponse.json({ error: "TXT 내보내기 옵션이 올바르지 않습니다." }, { status: 400 });
  const { data, error } = await fetchAllByRange((from, to) => context.admin.from("log_entries").select(LOG_ENTRY_DTO_COLUMNS)
    .eq("log_id", context.log.id).eq("is_deleted", false).order("sort_key").order("order_index").range(from, to));
  if (error) return databaseErrorResponse(error, "TXT를 만들지 못했습니다.");
  const entries = (data ?? []).map((entry) => toLogEntryDto(entry as Record<string, unknown>));
  const isReview = exportRequest.preset === "review";
  const text = isReview ? createReviewExport(entries) : applyCorrections(entries, exportRequest.settings);
  const filename = `${context.page.title.replace(/[\\/:*?"<>|]/g, "_") || "log"}${isReview ? "_검수용" : ""}.txt`;
  return new NextResponse(`\uFEFF${text}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "no-store" } });
}
