import { notFound } from "next/navigation";
import { LogEditor, type ImportSummary } from "@/components/LogEditor";
import { requireApprovedSession } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { LogEntry, Publication, ResourcePermissions, WorkspacePage } from "@/lib/types";
import { toLogEntryDto } from "@/lib/logs/dto";
import { parseLogFontFamily } from "@/lib/fonts";
import { LogFontPreload } from "@/components/logs/LogFontPreload";

type WorkspaceLogPagePayload = {
  page: WorkspacePage;
  logId: string;
  importReport: ImportSummary | null;
  totalCount: number;
  entries: Record<string, unknown>[];
  publication: Publication | null;
  permissions: ResourcePermissions;
};

export default async function WorkspaceLogPage({ params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const { id } = await params;
  await requireApprovedSession();
  const sessionAt = performance.now();
  const supabase = await createSupabaseServerClient();
  const [{ data, error }, { data: typography, error: typographyError }] = await Promise.all([
    supabase.rpc("get_workspace_log_page", { target_page_id: id, batch_size: 50 }),
    supabase.from("pages").select("font_family").eq("id", id).single()
  ]);
  const completedAt = performance.now();
  if (error || !data) notFound();
  const payload = data as WorkspaceLogPagePayload;
  // The aggregate RPC predates page typography and omits font_family.
  // Read through the approved user's RLS client before rendering the log.
  if (typographyError) throw new Error("page typography lookup failed");
  const fontFamily = parseLogFontFamily(typography?.font_family);
  const initialPage = { ...payload.page, font_family: fontFamily };
  const safeEntries = (payload.entries ?? []).map(toLogEntryDto) as LogEntry[];
  console.info(JSON.stringify({ event: "workspace_log_page_timing", sessionMs: Math.round(sessionAt - startedAt), dbMs: Math.round(completedAt - sessionAt), entryCount: safeEntries.length, payloadBytes: Buffer.byteLength(JSON.stringify(payload.entries ?? [])), totalMs: Math.round(completedAt - startedAt) }));
  return <><LogFontPreload font={fontFamily} /><LogEditor page={initialPage} permissions={payload.permissions} logId={payload.logId} entries={safeEntries} totalEntryCount={payload.totalCount ?? safeEntries.length} publication={payload.publication ?? null} importReport={payload.importReport ?? null} key={payload.page.id} /></>;
}
