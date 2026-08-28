import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { replaceTextPreservingMarkup } from "@/lib/logs/html";
import { isImageOnlyDocument, projectDocumentText } from "@/lib/logs/model/projection";
import { applyEditableTextChanges, applyRichStyleChanges, editableTextSegments, styledContentTargets, type EditableTextChange } from "@/lib/logs/model/user-edit";
import { sanitizeRichStyle } from "@/lib/logs/rich/style";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import { LOG_ENTRY_DTO_COLUMNS, toLogEntryDto } from "@/lib/logs/dto";
import { databaseErrorResponse } from "@/lib/api-error";

async function contextFor(request: NextRequest, token: string) {
  return getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string; entryId: string }> }) {
  const { token, entryId } = await params;
  const context = await contextFor(request, token);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.admin.from("log_entries").select(LOG_ENTRY_DTO_COLUMNS)
    .eq("id", entryId).eq("log_id", context.log.id).maybeSingle();
  return error ? databaseErrorResponse(error, "메시지를 불러오지 못했습니다.") : data ? NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string; entryId: string }> }) {
  const { token, entryId } = await params;
  const context = await contextFor(request, token);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  if (!context.canEdit) return NextResponse.json({ error: "Guest 뷰어는 로그를 수정할 수 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { data: entry } = await context.admin.from("log_entries")
    .select("id, document_version, document, original_document, content, raw_html, updated_at")
    .eq("id", entryId).eq("log_id", context.log.id).eq("is_deleted", false).maybeSingle();
  if (!entry) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  if (entry.document_version === 2) {
    const current = validateLogEntryDocument(entry.document);
    if (!current.ok) return NextResponse.json({ error: "현재 문서 구조가 올바르지 않습니다." }, { status: 400 });
    let nextDocument = current.document;
    const styleWarnings: string[] = [];
    if (Array.isArray(body.contentEdits)) {
      const allowed = new Set(editableTextSegments(current.document).map((segment) => segment.id));
      const changes: EditableTextChange[] = [];
      for (const value of body.contentEdits) {
        if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.text !== "string" || !allowed.has(value.id) || value.text.length > 200_000) return NextResponse.json({ error: "수정할 수 없는 내용 영역입니다." }, { status: 400 });
        changes.push({ id: value.id, text: value.text });
      }
      nextDocument = applyEditableTextChanges(current.document, changes);
    } else if (Array.isArray(body.styleEdits)) {
      const original = validateLogEntryDocument(entry.original_document ?? entry.document);
      if (!original.ok || original.document.source.platform !== "roll20") return NextResponse.json({ error: "Roll20 원본 CSS snapshot이 없습니다." }, { status: 400 });
      const allowed = new Set(styledContentTargets(original.document).map((target) => target.id));
      const changes = [];
      for (const value of body.styleEdits) {
        if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.css !== "string" || !allowed.has(value.id) || value.css.length > 20_000) return NextResponse.json({ error: "Roll20 원본 Content CSS만 수정할 수 있습니다." }, { status: 400 });
        const sanitized = sanitizeRichStyle(value.css); styleWarnings.push(...sanitized.warnings); changes.push({ id: value.id, style: sanitized.style });
      }
      nextDocument = applyRichStyleChanges(current.document, changes);
    } else return NextResponse.json({ error: "지원하지 않는 편집 방식입니다." }, { status: 400 });
    const validated = validateLogEntryDocument(nextDocument);
    if (!validated.ok) return NextResponse.json({ error: validated.error ?? "문서 구조가 올바르지 않습니다." }, { status: 400 });
    const { data, error } = await context.admin.rpc("update_guest_log_entry_document", {
      target_guest_participant_id: context.participant.id, target_page_id: context.page.id,
      target_entry_id: entryId, next_document: validated.document,
      next_content: projectDocumentText(validated.document),
      next_has_image_content: isImageOnlyDocument(validated.document), revision_action: "edit",
      expected_updated_at: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null
    });
    if (error?.code === "40001") return NextResponse.json({ error: "다른 참여자가 먼저 수정했습니다. 다시 시도해주세요." }, { status: 409 });
    return error ? databaseErrorResponse(error, "Guest 메시지를 수정하지 못했습니다.") : NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>), styleWarnings });
  }
  if (typeof body.content !== "string" || body.content.length > 200_000) return NextResponse.json({ error: "수정할 내용을 확인해주세요." }, { status: 400 });
  const { data, error } = await context.admin.rpc("update_guest_log_entry_content", {
    target_guest_participant_id: context.participant.id, target_page_id: context.page.id,
    target_entry_id: entryId, next_content: body.content,
    next_raw_html: replaceTextPreservingMarkup(entry.raw_html, body.content),
    expected_updated_at: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null
  });
  if (error?.code === "40001") return NextResponse.json({ error: "다른 참여자가 먼저 수정했습니다. 다시 시도해주세요." }, { status: 409 });
  return error ? databaseErrorResponse(error, "Guest 메시지를 수정하지 못했습니다.") : NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ token: string; entryId: string }> }) {
  const { token, entryId } = await params;
  const context = await contextFor(request, token);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  if (!context.canEdit) return NextResponse.json({ error: "Guest 뷰어는 로그를 수정할 수 없습니다." }, { status: 403 });
  const { data, error } = await context.admin.rpc("set_guest_log_entry_deleted", {
    target_guest_participant_id: context.participant.id, target_page_id: context.page.id,
    target_entry_id: entryId, should_delete: true
  });
  return error ? databaseErrorResponse(error, "Guest 메시지를 삭제하지 못했습니다.") : NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) });
}
