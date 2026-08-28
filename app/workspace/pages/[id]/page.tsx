import { notFound } from "next/navigation";
import { LogEditor, type ImportSummary } from "@/components/LogEditor";
import { requireApprovedSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LogEntry, Publication, WorkspacePage } from "@/lib/types";
import { toLogEntryDto } from "@/lib/logs/dto";

type WorkspaceLogPagePayload = {
  page: WorkspacePage;
  logId: string;
  importReport: ImportSummary | null;
  totalCount: number;
  entries: Record<string, unknown>[];
  publication: Publication | null;
};

export default async function WorkspaceLogPage({ params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const { id } = await params;
  await requireApprovedSession();
  const sessionAt = performance.now();
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_workspace_log_page", { target_page_id: id, batch_size: 50 });
  const completedAt = performance.now();
  if (error || !data) notFound();
  const payload = data as WorkspaceLogPagePayload;
  const safeEntries = (payload.entries ?? []).map(toLogEntryDto) as LogEntry[];
  console.info(JSON.stringify({ event: "workspace_log_page_timing", sessionMs: Math.round(sessionAt - startedAt), dbMs: Math.round(completedAt - sessionAt), entryCount: safeEntries.length, payloadBytes: Buffer.byteLength(JSON.stringify(payload.entries ?? [])), totalMs: Math.round(completedAt - startedAt) }));
  return <LogEditor page={payload.page} logId={payload.logId} entries={safeEntries} totalEntryCount={payload.totalCount ?? safeEntries.length} publication={payload.publication ?? null} importReport={payload.importReport ?? null} />;
}
