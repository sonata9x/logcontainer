import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { gzipArchive, LOG_GENERATION_BUCKET, removePrivateArchives, ROLL20_SOURCE_BUCKET, uploadPrivateArchive } from "@/lib/logs/archive";
import { importRoll20HtmlV2 } from "@/lib/logs/roll20/import-v2";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toLogEntryDto } from "@/lib/logs/dto";
import { enforceRateLimit } from "@/lib/rate-limit";
import { databaseErrorResponse, internalErrorResponse } from "@/lib/api-error";
import { consumeImportUpload, isImportUploadId } from "@/lib/logs/import-upload";
import { MAX_DIRECT_ROLL20_SOURCE_SIZE, MAX_STAGED_ROLL20_SOURCE_SIZE } from "@/lib/logs/import-limits";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log" || !context.canReimport) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const limited = await enforceRateLimit(request, { scope: "log-import", identity: context.user.id, maxRequests: 6, windowSeconds: 600, blockSeconds: 900 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const { data: log } = await context.supabase.from("logs").select("id, content_version, visible_entry_count").eq("page_id", id).maybeSingle();
  if (!log) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });

  let source = typeof body.source === "string" ? body.source : "";
  if (isImportUploadId(body.uploadId)) {
    let staged;
    try {
      staged = await consumeImportUpload({ uploadId: body.uploadId, pageId: id, ownerId: context.user.id });
    } catch (error) {
      return internalErrorResponse(error, "업로드한 HTML을 불러오지 못했습니다.");
    }
    if (!staged || staged.logId !== log.id) return NextResponse.json({ error: "업로드가 만료되었거나 이미 사용되었습니다." }, { status: 400 });
    if (staged.payload.byteLength > MAX_STAGED_ROLL20_SOURCE_SIZE) return NextResponse.json({ error: "Roll20 HTML 파일은 최대 12MB까지 업로드할 수 있습니다." }, { status: 413 });
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(staged.payload);
    } catch {
      return NextResponse.json({ error: "HTML 파일은 UTF-8 형식이어야 합니다." }, { status: 400 });
    }
  } else {
    if (!source.trim()) return NextResponse.json({ error: "가져올 HTML이 없습니다." }, { status: 400 });
    if (Buffer.byteLength(source, "utf8") > MAX_DIRECT_ROLL20_SOURCE_SIZE) return NextResponse.json({ error: "붙여넣기는 최대 4MB까지 가능합니다. 더 큰 HTML은 파일 업로드를 사용해주세요." }, { status: 413 });
  }
  const sourceReadyAt = performance.now();

  let imported;
  try {
    imported = importRoll20HtmlV2(source, { removeHiddenMessages: body.removeHiddenMessages === true });
  } catch {
    return NextResponse.json({ error: "Roll20 msgdata 또는 .message 요소가 있는 HTML만 가져올 수 있습니다." }, { status: 400 });
  }
  if (!imported.entries.length) return NextResponse.json({ error: "메시지 블록을 찾지 못했습니다." }, { status: 400 });
  const parsedAt = performance.now();

  const importId = randomUUID();
  const sourcePath = `${log.id}/${importId}.html.gz`;
  const sourceArchive = gzipArchive(source);
  const uploaded: Array<{ bucket: string; path: string }> = [];
  let previousGenerationPath: string | null = null;

  try {
    await uploadPrivateArchive(ROLL20_SOURCE_BUCKET, sourcePath, sourceArchive.compressed, "application/gzip");
    uploaded.push({ bucket: ROLL20_SOURCE_BUCKET, path: sourcePath });
    if ((log.visible_entry_count ?? 0) > 0) {
      const admin = createSupabaseAdminClient();
      const { data: previousEntries, error: entryError } = await admin.from("log_entries").select("id, log_id, order_index, sort_key, entry_type, speaker_name, speaker_color, content, original_content, raw_html, document_version, document, original_document, metadata, is_deleted, deleted_at, is_added, updated_by, created_at, updated_at").eq("log_id", log.id).order("sort_key");
      if (entryError) throw entryError;
      const entryIds = (previousEntries ?? []).map((entry) => entry.id);
      const revisionResult = entryIds.length
        ? await admin.from("log_entry_revisions").select("id, entry_id, editor_id, action, previous_content, next_content, previous_snapshot, next_snapshot, revision_schema_version, created_at").in("entry_id", entryIds).order("created_at")
        : { data: [], error: null };
      if (revisionResult.error) throw revisionResult.error;
      const generationArchive = gzipArchive(JSON.stringify({
        schemaVersion: 1,
        logId: log.id,
        contentVersion: log.content_version,
        entries: previousEntries ?? [],
        revisions: revisionResult.data ?? []
      }));
      previousGenerationPath = `${log.id}/${importId}-previous.json.gz`;
      await uploadPrivateArchive(LOG_GENERATION_BUCKET, previousGenerationPath, generationArchive.compressed, "application/gzip");
      uploaded.push({ bucket: LOG_GENERATION_BUCKET, path: previousGenerationPath });
    }
  } catch (error) {
    await removePrivateArchives(uploaded);
    return internalErrorResponse(error, "원본 archive 저장에 실패했습니다.");
  }
  const archivedAt = performance.now();

  const { data, error } = await context.supabase.rpc("replace_log_entries_v3", {
    target_page_id: id,
    import_id: importId,
    source_storage_path: sourcePath,
    source_sha256: sourceArchive.sha256,
    source_size_bytes: sourceArchive.sourceSizeBytes,
    compressed_size_bytes: sourceArchive.compressedSizeBytes,
    source_platform: imported.platform,
    report: imported.report,
    entries: imported.entries,
    expected_content_version: log.content_version,
    previous_generation_storage_path: previousGenerationPath
  });
  if (error) {
    await removePrivateArchives(uploaded);
    return error.code === "40001"
      ? NextResponse.json({ error: "가져오기 중 로그가 변경됐습니다. 다시 시도해주세요." }, { status: 409 })
      : databaseErrorResponse(error, "로그를 저장하지 못했습니다.");
  }
  const { data: pageData } = await context.supabase.rpc("get_log_entries_page", { target_page_id: id, after_sort_key: null, batch_size: 50 });
  const completedAt = performance.now();
  return NextResponse.json({ ...(data as object), report: imported.report, entries: ((pageData?.entries ?? []) as Record<string, unknown>[]).map(toLogEntryDto) }, {
    headers: { "Server-Timing": `source;dur=${(sourceReadyAt - startedAt).toFixed(1)}, parse;dur=${(parsedAt - sourceReadyAt).toFixed(1)}, archive;dur=${(archivedAt - parsedAt).toFixed(1)}, db;dur=${(completedAt - archivedAt).toFixed(1)}` }
  });
}
