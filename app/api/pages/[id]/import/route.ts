import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { downloadPrivateArchive, gunzipArchive, gzipArchive, LOG_GENERATION_BUCKET, removePrivateArchives, ROLL20_SOURCE_BUCKET, uploadPrivateArchive } from "@/lib/logs/archive";
import { importLogHtml } from "@/lib/logs/import/registry";
import { ImportPlatformError, type SupportedImportPlatform } from "@/lib/logs/import/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toLogEntryDto } from "@/lib/logs/dto";
import { enforceRateLimit } from "@/lib/rate-limit";
import { databaseErrorResponse, internalErrorResponse } from "@/lib/api-error";
import { consumeImportUpload, isImportUploadId } from "@/lib/logs/import-upload";
import { MAX_DIRECT_ROLL20_SOURCE_SIZE, MAX_STAGED_ROLL20_SOURCE_SIZE } from "@/lib/logs/import-limits";
import { persistTakoyakiAvatarAssets } from "@/lib/logs/takoyaki-box/assets";
import { AppendImportError, calculateAppendedImport } from "@/lib/logs/import/append";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log" || !context.canReimport) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const limited = await enforceRateLimit(request, { scope: "log-import", identity: context.user.id, maxRequests: 6, windowSeconds: 600, blockSeconds: 900 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  if (body.platform === "ccfolia") return NextResponse.json({ error: "CCFOLIA 가져오기는 아직 지원하지 않습니다." }, { status: 400 });
  if (!(["roll20", "takoyaki-box"] as unknown[]).includes(body.platform)) {
    return NextResponse.json({ error: "업로드할 로그의 플랫폼을 선택해주세요." }, { status: 400 });
  }
  const requestedPlatform = body.platform as SupportedImportPlatform;
  const importMode = body.mode === "append" ? "append" : "refresh";
  const { data: log } = await context.supabase.from("logs").select("id, content_version, visible_entry_count, platform").eq("page_id", id).maybeSingle();
  if (!log) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const admin = createSupabaseAdminClient();

  let source = typeof body.source === "string" ? body.source : "";
  if (isImportUploadId(body.uploadId)) {
    let staged;
    try {
      staged = await consumeImportUpload({ uploadId: body.uploadId, pageId: id, ownerId: context.user.id });
    } catch (error) {
      return internalErrorResponse(error, "업로드한 HTML을 불러오지 못했습니다.");
    }
    if (!staged || staged.logId !== log.id) return NextResponse.json({ error: "업로드가 만료되었거나 이미 사용되었습니다." }, { status: 400 });
    if (staged.payload.byteLength > MAX_STAGED_ROLL20_SOURCE_SIZE) return NextResponse.json({ error: "로그 HTML 파일은 최대 12MB까지 업로드할 수 있습니다." }, { status: 413 });
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(staged.payload);
    } catch {
      return NextResponse.json({ error: "HTML 파일은 UTF-8 형식이어야 합니다." }, { status: 400 });
    }
  } else if (!source.trim() && importMode === "refresh") {
    const { data: latestImport, error } = await admin.from("log_imports").select("source_html, source_storage_path, compression").eq("log_id", log.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) return databaseErrorResponse(error, "현재 원본 HTML을 찾지 못했습니다.");
    if (!latestImport) return NextResponse.json({ error: "갱신할 원본 HTML이 없습니다. HTML 파일을 먼저 업로드해주세요." }, { status: 400 });
    try {
      if (latestImport.source_storage_path) {
        const archived = await downloadPrivateArchive(ROLL20_SOURCE_BUCKET, latestImport.source_storage_path);
        const raw = latestImport.compression === "gzip" ? gunzipArchive(archived) : archived;
        if (raw.byteLength > MAX_STAGED_ROLL20_SOURCE_SIZE) return NextResponse.json({ error: "저장된 원본 HTML이 현재 허용 크기를 초과합니다." }, { status: 413 });
        source = new TextDecoder("utf-8", { fatal: true }).decode(raw);
      } else if (typeof latestImport.source_html === "string") source = latestImport.source_html;
      else return NextResponse.json({ error: "갱신할 원본 HTML이 없습니다. HTML 파일을 다시 업로드해주세요." }, { status: 400 });
    } catch (error) {
      return internalErrorResponse(error, "현재 원본 HTML을 불러오지 못했습니다.");
    }
  } else {
    if (!source.trim()) return NextResponse.json({ error: "가져올 HTML이 없습니다." }, { status: 400 });
    if (Buffer.byteLength(source, "utf8") > MAX_DIRECT_ROLL20_SOURCE_SIZE) return NextResponse.json({ error: "붙여넣기는 최대 4MB까지 가능합니다. 더 큰 HTML은 파일 업로드를 사용해주세요." }, { status: 413 });
  }
  const sourceReadyAt = performance.now();

  let imported;
  try {
    imported = importLogHtml(source, requestedPlatform, {
      separateCasual: body.separateCasual === true
    });
  } catch (error) {
    const message = error instanceof ImportPlatformError ? error.message : "선택한 플랫폼의 로그 구조를 HTML에서 찾지 못했습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
  if (!imported.entries.length) return NextResponse.json({ error: "메시지 블록을 찾지 못했습니다." }, { status: 400 });
  const parsedAt = performance.now();

  let previousEntries: Record<string, unknown>[] = [];
  if (importMode === "append" || (log.visible_entry_count ?? 0) > 0) {
    const { data, error } = await admin.from("log_entries").select("id, log_id, order_index, sort_key, entry_type, speaker_name, speaker_color, content, original_content, raw_html, document_version, document, original_document, metadata, is_deleted, deleted_at, is_added, updated_by, created_at, updated_at").eq("log_id", log.id).order("sort_key");
    if (error) return databaseErrorResponse(error, "기존 로그 원본을 불러오지 못했습니다.");
    previousEntries = (data ?? []) as Record<string, unknown>[];
  }
  let entriesToWrite = imported.entries;
  let cleanupEntryIds: string[] = [];
  let finalReport: Record<string, unknown> = { ...imported.report, importMode };
  if (importMode === "append") {
    if (log.platform && log.platform !== imported.platform) return NextResponse.json({ error: "기존 로그와 같은 플랫폼의 전체 HTML을 업로드해주세요." }, { status: 400 });
    try {
      const plan = calculateAppendedImport(previousEntries.map((entry) => ({
        id: String(entry.id), is_added: entry.is_added === true,
        document: entry.document, original_document: entry.original_document
      })), imported.entries);
      if (!plan.appendedEntries.length) return NextResponse.json({ error: "추가된 로그 블록이 없습니다. 파서 패치만 적용하려면 HTML 갱신을 사용해주세요." }, { status: 400 });
      entriesToWrite = plan.appendedEntries;
      cleanupEntryIds = plan.cleanupEntryIds;
      finalReport = { ...finalReport, baselineMessageCount: plan.baselineCount, appendedCount: entriesToWrite.length, cleanedLegacyCount: cleanupEntryIds.length };
    } catch (error) {
      if (error instanceof AppendImportError) return NextResponse.json({ error: error.message }, { status: 409 });
      throw error;
    }
  }

  const importId = randomUUID();
  const sourcePath = `${log.id}/${importId}.html.gz`;
  const sourceArchive = gzipArchive(source);
  const uploaded: Array<{ bucket: string; path: string }> = [];
  let previousGenerationPath: string | null = null;

  try {
    uploaded.push(...await persistTakoyakiAvatarAssets(imported, log.id, importId));
    await uploadPrivateArchive(ROLL20_SOURCE_BUCKET, sourcePath, sourceArchive.compressed, "application/gzip");
    uploaded.push({ bucket: ROLL20_SOURCE_BUCKET, path: sourcePath });
    if ((log.visible_entry_count ?? 0) > 0) {
      const entryIds = previousEntries.map((entry) => entry.id);
      const revisionResult = entryIds.length
        ? await admin.from("log_entry_revisions").select("id, entry_id, editor_id, action, previous_content, next_content, previous_snapshot, next_snapshot, revision_schema_version, created_at").in("entry_id", entryIds).order("created_at")
        : { data: [], error: null };
      if (revisionResult.error) throw revisionResult.error;
      const generationArchive = gzipArchive(JSON.stringify({
        schemaVersion: 1,
        logId: log.id,
        contentVersion: log.content_version,
        entries: previousEntries,
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

  const rpcName = importMode === "append" ? "append_log_entries_v1" : "replace_log_entries_v3";
  const rpcArgs = {
    target_page_id: id,
    import_id: importId,
    source_storage_path: sourcePath,
    source_sha256: sourceArchive.sha256,
    source_size_bytes: sourceArchive.sourceSizeBytes,
    compressed_size_bytes: sourceArchive.compressedSizeBytes,
    source_platform: imported.platform,
    report: finalReport,
    entries: entriesToWrite,
    expected_content_version: log.content_version,
    previous_generation_storage_path: previousGenerationPath,
    ...(importMode === "append" ? { cleanup_entry_ids: cleanupEntryIds } : {})
  };
  const { data, error } = await context.supabase.rpc(rpcName, rpcArgs);
  if (error) {
    await removePrivateArchives(uploaded);
    return error.code === "40001"
      ? NextResponse.json({ error: "가져오기 중 로그가 변경됐습니다. 다시 시도해주세요." }, { status: 409 })
      : databaseErrorResponse(error, "로그를 저장하지 못했습니다.");
  }
  const { data: pageData } = await context.supabase.rpc("get_log_entries_page", { target_page_id: id, after_sort_key: null, batch_size: 50 });
  const completedAt = performance.now();
  return NextResponse.json({ ...(data as object), report: finalReport, entries: ((pageData?.entries ?? []) as Record<string, unknown>[]).map(toLogEntryDto) }, {
    headers: { "Server-Timing": `source;dur=${(sourceReadyAt - startedAt).toFixed(1)}, parse;dur=${(parsedAt - sourceReadyAt).toFixed(1)}, archive;dur=${(archivedAt - parsedAt).toFixed(1)}, db;dur=${(completedAt - archivedAt).toFixed(1)}` }
  });
}
