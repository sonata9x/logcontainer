import { notFound } from "next/navigation";
import { LogEditor, type ImportSummary } from "@/components/LogEditor";
import { requireWorkspaceSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LogEntry, Publication, WorkspacePage } from "@/lib/types";
import { toLogEntryDto } from "@/lib/logs/dto";

export default async function WorkspaceLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireWorkspaceSession();
  const supabase = await createSupabaseServerClient();
  const { data: page } = await supabase.from("pages").select("id, workspace_id, parent_id, page_type, title, icon, order_index, is_archived, original_owner_id, deleted_at, created_at, updated_at").eq("id", id).eq("page_type", "log").is("deleted_at", null).maybeSingle();
  if (!page) notFound();
  const { data: permissionData } = await supabase.rpc("get_resource_permissions", { target_resource_id: id });
  const permissions = permissionData as { isOriginalOwner?: boolean; canSelfRemove?: boolean } | null;
  const { data: log } = await supabase.from("logs").select("id, import_report, visible_entry_count").eq("page_id", id).single();
  const [{ data: entries }, { data: publication }] = await Promise.all([
    supabase.rpc("get_log_entries_page", { target_page_id: id, after_sort_key: null, batch_size: 200 }),
    supabase.from("publications").select("id, page_id, token, is_active, published_at, updated_at").eq("page_id", id).maybeSingle()
  ]);
  const safeEntries = (((entries as { entries?: Record<string, unknown>[] } | null)?.entries ?? []).map(toLogEntryDto)) as LogEntry[];
  const resourcePage = {
    ...page,
    is_original_owner: Boolean(permissions?.isOriginalOwner ?? page.original_owner_id === session.user.id),
    can_self_remove: Boolean(permissions?.canSelfRemove)
  } as WorkspacePage;
  return <LogEditor page={resourcePage} logId={log!.id} entries={safeEntries} totalEntryCount={log?.visible_entry_count ?? safeEntries.length} publication={(publication as Publication | null) ?? null} importReport={(log?.import_report as ImportSummary | null) ?? null} />;
}
