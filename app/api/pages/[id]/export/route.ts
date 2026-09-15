import { getApiPageContext } from "@/lib/api-auth";
import { applyCorrections, createReviewExport, defaultCorrectionSettings, parseCorrectionSettings, parseExportRequest } from "@/lib/logs/corrections";
import { fetchAllByRange } from "@/lib/logs/export-all";
import type { LogEntry } from "@/lib/types";
import { databaseErrorResponse } from "@/lib/api-error";

async function exportLog(id: string, requestBody?: unknown) {
  const context = await getApiPageContext(id);
  if (!context) return new Response("Not found", { status: 404 });
  const { data: page } = await context.supabase.from("pages").select("title").eq("id", id).single();
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).single();
  if (!log) return new Response("Not found", { status: 404 });
  const [{ data: entries, error: entryError }, { data: preferences, error: preferenceError }] = await Promise.all([
    fetchAllByRange((from, to) => context.supabase.from("log_entries").select("id, log_id, order_index, sort_key, entry_type, speaker_name, speaker_color, content, document_version, has_image_content, is_deleted, updated_at").eq("log_id", log!.id).eq("is_deleted", false).order("sort_key").order("order_index").range(from, to)),
    context.supabase.from("user_preferences").select("correction_settings").eq("user_id", context.user.id).maybeSingle()
  ]);
  if (entryError || preferenceError) return databaseErrorResponse(entryError ?? preferenceError!, "TXT를 만들지 못했습니다.");
  const exportRequest = requestBody === undefined ? null : parseExportRequest(requestBody);
  if (requestBody !== undefined && !exportRequest) return new Response(JSON.stringify({ error: "TXT 내보내기 옵션이 올바르지 않습니다." }), { status: 400, headers: { "Content-Type": "application/json" } });
  const isReview = exportRequest?.preset === "review";
  const settings = exportRequest?.preset === "custom"
    ? exportRequest.settings
    : parseCorrectionSettings(preferences?.correction_settings) ?? defaultCorrectionSettings;
  const text = isReview ? createReviewExport((entries ?? []) as LogEntry[]) : applyCorrections((entries ?? []) as LogEntry[], settings);
  const safeTitle = (page?.title ?? "roll20-log").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
  const filename = `${safeTitle}${isReview ? "_검수용" : ""}.txt`;
  return new Response(`\uFEFF${text}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return exportLog((await params).id);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return exportLog((await params).id, await request.json().catch(() => null));
}
