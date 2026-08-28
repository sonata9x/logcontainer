import { getApiPageContext } from "@/lib/api-auth";
import { applyCorrections, defaultCorrectionSettings, parseCorrectionSettings, type CorrectionSettings } from "@/lib/logs/corrections";
import type { LogEntry } from "@/lib/types";
import { databaseErrorResponse } from "@/lib/api-error";

async function exportLog(id: string, requestedSettings?: unknown) {
  const context = await getApiPageContext(id);
  if (!context) return new Response("Not found", { status: 404 });
  const { data: page } = await context.supabase.from("pages").select("title").eq("id", id).single();
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).single();
  if (!log) return new Response("Not found", { status: 404 });
  const [{ data: entries, error: entryError }, { data: preferences, error: preferenceError }] = await Promise.all([
    context.supabase.from("log_entries").select("id, log_id, order_index, sort_key, entry_type, speaker_name, speaker_color, content, document_version, has_image_content, is_deleted, updated_at").eq("log_id", log!.id).eq("is_deleted", false).order("sort_key"),
    context.supabase.from("user_preferences").select("correction_settings").eq("user_id", context.user.id).maybeSingle()
  ]);
  if (entryError || preferenceError) return databaseErrorResponse(entryError ?? preferenceError!, "TXT를 만들지 못했습니다.");
  const settings = requestedSettings === undefined
    ? parseCorrectionSettings(preferences?.correction_settings) ?? defaultCorrectionSettings
    : parseCorrectionSettings(requestedSettings);
  if (!settings) return new Response(JSON.stringify({ error: "TXT 교정 옵션이 올바르지 않습니다." }), { status: 400, headers: { "Content-Type": "application/json" } });
  const text = applyCorrections((entries ?? []) as LogEntry[], settings as CorrectionSettings);
  const safeTitle = (page?.title ?? "roll20-log").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
  return new Response(`\uFEFF${text}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.txt`, "Cache-Control": "private, no-store" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return exportLog((await params).id);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return exportLog((await params).id, await request.json().catch(() => null));
}
