import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { gzipArchive, LOG_GENERATION_BUCKET, removePrivateArchives, uploadPrivateArchive } from "@/lib/logs/archive";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { databaseErrorResponse, internalErrorResponse } from "@/lib/api-error";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canRestoreOriginal || context.page.page_type !== "log") return NextResponse.json({ error: "원본 복원 권한이 없습니다." }, { status: 403 });
  const { data: log } = await context.supabase.from("logs").select("id, content_version").eq("page_id", id).maybeSingle();
  if (!log) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const { count: importCount } = await admin.from("log_imports").select("id", { count: "exact", head: true }).eq("log_id", log.id);
  if (!importCount) return NextResponse.json({ error: "복원할 HTML import 기준점이 없습니다." }, { status: 409 });
  const { data: entries, error: entryError } = await admin.from("log_entries").select("id, log_id, order_index, sort_key, entry_type, speaker_name, speaker_color, content, original_content, raw_html, document_version, document, original_document, metadata, is_deleted, deleted_at, is_added, updated_by, created_at, updated_at").eq("log_id", log.id).order("sort_key");
  if (entryError) return databaseErrorResponse(entryError, "복원 전 로그 generation을 읽지 못했습니다.");
  const entryIds = (entries ?? []).map((entry) => entry.id);
  const revisionResult = entryIds.length
    ? await admin.from("log_entry_revisions").select("id, entry_id, editor_id, guest_participant_id, action, previous_content, next_content, previous_snapshot, next_snapshot, revision_schema_version, created_at").in("entry_id", entryIds).order("created_at")
    : { data: [], error: null };
  if (revisionResult.error) return databaseErrorResponse(revisionResult.error, "복원 전 revision을 읽지 못했습니다.");
  const restoreId = randomUUID();
  const storagePath = `${log.id}/${restoreId}-pre-restore.json.gz`;
  const archive = gzipArchive(JSON.stringify({ schemaVersion: 1, reason: "restore-original", logId: log.id, contentVersion: log.content_version, entries: entries ?? [], revisions: revisionResult.data ?? [] }));
  try {
    await uploadPrivateArchive(LOG_GENERATION_BUCKET, storagePath, archive.compressed, "application/gzip");
  } catch (error) {
    return internalErrorResponse(error, "복원 전 generation archive 저장에 실패했습니다.");
  }
  const { data, error } = await context.supabase.rpc("restore_log_original", {
    target_page_id: id, restore_event_id: restoreId, generation_storage_path: storagePath
  });
  if (error) {
    await removePrivateArchives([{ bucket: LOG_GENERATION_BUCKET, path: storagePath }]);
    return databaseErrorResponse(error, "로그를 원본으로 복원하지 못했습니다.");
  }
  return NextResponse.json(data);
}
