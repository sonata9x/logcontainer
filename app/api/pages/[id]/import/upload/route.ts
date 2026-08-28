import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { internalErrorResponse } from "@/lib/api-error";
import { cancelImportUpload, createImportUploadTarget, isImportUploadId } from "@/lib/logs/import-upload";
import { MAX_STAGED_ROLL20_SOURCE_SIZE, ROLL20_IMPORT_STAGING_BUCKET } from "@/lib/logs/import-limits";
import { enforceRateLimit } from "@/lib/rate-limit";

async function getOwnerLogContext(pageId: string) {
  const context = await getApiPageContext(pageId);
  if (!context || context.page.page_type !== "log" || !context.canReimport) return null;
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", pageId).maybeSingle();
  return log ? { ...context, log } : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getOwnerLogContext(id);
  if (!context) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const limited = await enforceRateLimit(request, { scope: "log-import-upload-target", identity: context.user.id, maxRequests: 6, windowSeconds: 600, blockSeconds: 900 });
  if (limited) return limited;
  const body = await request.json().catch(() => ({}));
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_STAGED_ROLL20_SOURCE_SIZE) {
    return NextResponse.json({ error: "Roll20 HTML 파일은 최대 12MB까지 업로드할 수 있습니다." }, { status: 413 });
  }
  try {
    const target = await createImportUploadTarget({ pageId: id, logId: context.log.id, ownerId: context.user.id, sizeBytes });
    return NextResponse.json({ ...target, bucket: ROLL20_IMPORT_STAGING_BUCKET, maxSizeBytes: MAX_STAGED_ROLL20_SOURCE_SIZE }, {
      status: 201,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return internalErrorResponse(error, "업로드 준비에 실패했습니다.");
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getOwnerLogContext(id);
  if (!context) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  if (!isImportUploadId(body.uploadId)) return NextResponse.json({ error: "업로드 정보를 확인할 수 없습니다." }, { status: 400 });
  try {
    await cancelImportUpload({ uploadId: body.uploadId, pageId: id, ownerId: context.user.id });
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return internalErrorResponse(error, "업로드를 정리하지 못했습니다.");
  }
}
