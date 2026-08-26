import { getApiPageContext } from "@/lib/api-auth";
import { applyCorrections, defaultCorrectionSettings, type CorrectionSettings } from "@/lib/logs/corrections";
import type { LogEntry } from "@/lib/types";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return new Response("Not found", { status: 404 });
  const { data: page } = await context.supabase.from("pages").select("title").eq("id", id).single();
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).single();
  const [{ data: entries }, { data: settings }] = await Promise.all([
    context.supabase.from("log_entries").select("*").eq("log_id", log!.id).eq("is_deleted", false).order("order_index"),
    context.supabase.from("correction_settings").select("*").eq("log_id", log!.id).maybeSingle()
  ]);
  const text = applyCorrections((entries ?? []) as LogEntry[], (settings ?? defaultCorrectionSettings) as CorrectionSettings);
  const safeTitle = (page?.title ?? "roll20-log").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
  return new Response(`\uFEFF${text}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.txt`, "Cache-Control": "private, no-store" } });
}
