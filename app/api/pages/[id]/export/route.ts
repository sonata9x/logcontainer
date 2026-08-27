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
    context.supabase.from("log_entries").select("id, log_id, order_index, sort_key, entry_type, speaker_name, speaker_color, content, document_version, has_image_content, is_deleted, updated_at").eq("log_id", log!.id).eq("is_deleted", false).order("sort_key"),
    context.supabase.from("correction_settings").select("remove_html_tags, normalize_ellipsis, normalize_quotes, speaker_tab_format, clean_blank_lines, mark_handout_position, custom_quote_open, custom_quote_close, custom_ellipsis, custom_handout_icon").eq("log_id", log!.id).maybeSingle()
  ]);
  const text = applyCorrections((entries ?? []) as LogEntry[], (settings ?? defaultCorrectionSettings) as CorrectionSettings);
  const safeTitle = (page?.title ?? "roll20-log").replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
  return new Response(`\uFEFF${text}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.txt`, "Cache-Control": "private, no-store" } });
}
