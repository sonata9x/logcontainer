import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { fetchAllByRange } from "@/lib/logs/export-all";
import { LOG_ENTRY_DTO_COLUMNS, toLogEntryDto } from "@/lib/logs/dto";
import { calculateLogStatistics, localWallClockValue } from "@/lib/logs/statistics";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log") return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const { data: log, error } = await context.supabase.from("logs").select("id, platform, updated_at").eq("page_id", id).maybeSingle();
  if (error) return databaseErrorResponse(error, "로그 정보를 불러오지 못했습니다.");
  if (!log) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const [{ data: latestImport }, { data: entries, error: entryError }] = await Promise.all([
    context.supabase.from("log_imports").select("created_at, report").eq("log_id", log.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    fetchAllByRange((from, to) => context.supabase.from("log_entries").select(LOG_ENTRY_DTO_COLUMNS).eq("log_id", log.id).eq("is_deleted", false).order("sort_key").order("order_index").range(from, to))
  ]);
  if (entryError) return databaseErrorResponse(entryError, "로그 통계를 계산하지 못했습니다.");
  const requestedOffset = Number(new URL(request.url).searchParams.get("timezoneOffsetMinutes"));
  const report = latestImport?.report && typeof latestImport.report === "object" ? latestImport.report as Record<string, unknown> : null;
  const storedOffset = report?.timezoneOffsetMinutes;
  const timezoneOffsetMinutes = Number.isInteger(storedOffset) && Number(storedOffset) >= -840 && Number(storedOffset) <= 840 ? Number(storedOffset) : requestedOffset;
  const referenceValue = latestImport?.created_at ? localWallClockValue(latestImport.created_at, timezoneOffsetMinutes) : null;
  const statistics = calculateLogStatistics((entries ?? []).map((entry) => toLogEntryDto(entry as Record<string, unknown>)), referenceValue);
  return NextResponse.json({ platform: log.platform, updatedAt: log.updated_at, latestImportAt: latestImport?.created_at ?? null, statistics });
}
