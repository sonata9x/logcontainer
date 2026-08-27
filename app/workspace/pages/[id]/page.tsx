import { notFound } from "next/navigation";
import { LogEditor, type ImportSummary } from "@/components/LogEditor";
import { requireWorkspaceSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LogEntry, Publication, WorkspacePage } from "@/lib/types";
import { sanitizeLogHtml } from "@/lib/logs/html";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";

export default async function WorkspaceLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspaceSession();
  const supabase = await createSupabaseServerClient();
  const { data: page } = await supabase.from("pages").select("*").eq("id", id).eq("page_type", "log").is("deleted_at", null).maybeSingle();
  if (!page) notFound();
  const { data: log } = await supabase.from("logs").select("id, import_report").eq("page_id", id).single();
  const [{ data: entries }, { data: publication }] = await Promise.all([
    supabase.from("log_entries").select("*").eq("log_id", log!.id).eq("is_deleted", false).order("order_index"),
    supabase.from("publications").select("*").eq("page_id", id).maybeSingle()
  ]);

  const safeEntries = ((entries ?? []) as LogEntry[]).map((entry) => {
    if (entry.document_version === 2 && entry.document) {
      const validated = validateLogEntryDocument(entry.document);
      const original = validateLogEntryDocument(entry.original_document);
      if (validated.ok) return { ...entry, document: validated.document, original_document: original.ok ? original.document : null, raw_html: null };
    }
    return { ...entry, raw_html: entry.raw_html ? sanitizeLogHtml(entry.raw_html) : null };
  });
  const resourcePage = { ...page, is_original_owner: page.original_owner_id === session.user.id } as WorkspacePage;
  return <LogEditor page={resourcePage} logId={log!.id} entries={safeEntries} publication={(publication as Publication | null) ?? null} importReport={(log?.import_report as ImportSummary | null) ?? null} />;
}
