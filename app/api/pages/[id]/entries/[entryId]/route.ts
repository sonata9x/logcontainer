import { NextResponse } from "next/server";
import { getAuthenticatedApiContext } from "@/lib/api-auth";
import { replaceTextPreservingMarkup } from "@/lib/logs/html";
import { isImageOnlyDocument, projectDocumentText } from "@/lib/logs/model/projection";
import { applyEditableTextChanges, applyRichStyleChanges, editableTextSegments, styledContentTargets, type EditableTextChange } from "@/lib/logs/model/user-edit";
import { sanitizeRichStyle } from "@/lib/logs/rich/style";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";
import { toLogEntryDto } from "@/lib/logs/dto";
import { databaseErrorResponse } from "@/lib/api-error";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const startedAt = performance.now();
  const { id, entryId } = await params;
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const authAt = performance.now();
  const body = await request.json().catch(() => ({}));
  const { data: entry } = await context.supabase.rpc("get_log_entry_edit_source", { target_page_id: id, target_entry_id: entryId });
  const sourceAt = performance.now();
  if (!entry) return NextResponse.json({ error: "블록을 찾을 수 없습니다." }, { status: 404 });

  if (entry.document_version === 2) {
    const current = validateLogEntryDocument(entry.document);
    if (!current.ok) return NextResponse.json({ error: "현재 문서 구조가 올바르지 않습니다." }, { status: 400 });
    let nextDocument = current.document;
    let revisionAction: "edit" | "restore" | "revert" = "edit";
    const styleWarnings: string[] = [];

    if (Array.isArray(body.contentEdits)) {
      const allowed = new Set(editableTextSegments(current.document).map((segment) => segment.id));
      const changes: EditableTextChange[] = [];
      for (const value of body.contentEdits) {
        if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.text !== "string" || !allowed.has(value.id)) {
          return NextResponse.json({ error: "수정할 수 없는 내용 영역입니다." }, { status: 400 });
        }
        if (value.text.length > 200_000) return NextResponse.json({ error: "메시지 내용이 너무 깁니다." }, { status: 400 });
        changes.push({ id: value.id, text: value.text });
      }
      nextDocument = applyEditableTextChanges(current.document, changes);
    } else if (Array.isArray(body.styleEdits)) {
      const original = validateLogEntryDocument(entry.original_document ?? entry.document);
      if (!original.ok || original.document.source.platform !== "roll20") return NextResponse.json({ error: "Roll20 원본 CSS snapshot이 없습니다." }, { status: 400 });
      const allowed = new Set(styledContentTargets(original.document).map((target) => target.id));
      const changes = [];
      for (const value of body.styleEdits) {
        if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.css !== "string" || !allowed.has(value.id)) {
          return NextResponse.json({ error: "Roll20 원본 Content CSS만 수정할 수 있습니다." }, { status: 400 });
        }
        if (value.css.length > 20_000) return NextResponse.json({ error: "CSS가 너무 깁니다." }, { status: 400 });
        const sanitized = sanitizeRichStyle(value.css);
        styleWarnings.push(...sanitized.warnings);
        changes.push({ id: value.id, style: sanitized.style });
      }
      nextDocument = applyRichStyleChanges(current.document, changes);
    } else if (body.restoreOriginal === true) {
      const original = validateLogEntryDocument(entry.original_document ?? entry.document);
      if (!original.ok || original.document.source.platform !== "roll20") return NextResponse.json({ error: "복원할 import 원본 document가 없습니다." }, { status: 400 });
      nextDocument = original.document;
      revisionAction = "restore";
    } else if (typeof body.revisionId === "string") {
      const { data: revision } = await context.supabase.from("log_entry_revisions").select("previous_snapshot").eq("id", body.revisionId).eq("entry_id", entryId).maybeSingle();
      const previous = validateLogEntryDocument(revision?.previous_snapshot);
      if (!previous.ok) return NextResponse.json({ error: "복원할 revision snapshot이 없습니다." }, { status: 400 });
      nextDocument = previous.document;
      revisionAction = "revert";
    } else {
      return NextResponse.json({ error: "지원하지 않는 v2 편집 방식입니다." }, { status: 400 });
    }

    const validated = validateLogEntryDocument(nextDocument);
    if (!validated.ok) return NextResponse.json({ error: validated.error ?? "문서 구조가 올바르지 않습니다." }, { status: 400 });
    const content = projectDocumentText(validated.document);
    const { data, error } = await context.supabase.rpc("update_log_entry_document_v3", {
      target_page_id: id, target_entry_id: entryId, next_document: validated.document, next_content: content,
      next_has_image_content: isImageOnlyDocument(validated.document),
      revision_action: revisionAction,
      expected_updated_at: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null
    });
    if (error?.code === "40001") return NextResponse.json({ error: "다른 멤버가 먼저 수정했습니다. 새로고침 후 다시 시도해주세요." }, { status: 409 });
    if (error) return databaseErrorResponse(error, "로그 블록을 수정하지 못했습니다.");
    const completedAt = performance.now();
    return NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>), styleWarnings }, { headers: { "Server-Timing": `auth;dur=${(authAt - startedAt).toFixed(1)}, source;dur=${(sourceAt - authAt).toFixed(1)}, write;dur=${(completedAt - sourceAt).toFixed(1)}` } });
  }
  if (typeof body.content !== "string") return NextResponse.json({ error: "수정할 내용이 없습니다." }, { status: 400 });

  const { data, error } = await context.supabase.rpc("update_log_entry_content_v3", {
    target_page_id: id,
    target_entry_id: entryId,
    next_content: body.content,
    next_raw_html: replaceTextPreservingMarkup(entry.raw_html, body.content),
    revision_action: body.revisionAction === "revert" ? "revert" : "edit",
    expected_updated_at: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null
  });
  if (error?.code === "40001") return NextResponse.json({ error: "다른 멤버가 먼저 수정했습니다. 새로고침 후 다시 시도해주세요." }, { status: 409 });
  if (error) return databaseErrorResponse(error, "로그 블록을 수정하지 못했습니다.");
  const completedAt = performance.now();
  return NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) }, { headers: { "Server-Timing": `auth;dur=${(authAt - startedAt).toFixed(1)}, source;dur=${(sourceAt - authAt).toFixed(1)}, write;dur=${(completedAt - sourceAt).toFixed(1)}` } });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (new URL(request.url).searchParams.get("view") === "entry") {
    const { data, error } = await context.supabase.rpc("get_log_entry_dto", { target_page_id: id, target_entry_id: entryId });
    return error ? databaseErrorResponse(error, "로그 블록을 불러오지 못했습니다.") : data ? NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) }) : NextResponse.json({ error: "블록을 찾을 수 없습니다." }, { status: 404 });
  }
  const { data, error } = await context.supabase.from("log_entry_revisions")
    .select("id, entry_id, action, editor_id, previous_content, next_content, created_at, revision_schema_version")
    .eq("entry_id", entryId).order("created_at", { ascending: false }).limit(50);
  return error ? databaseErrorResponse(error, "수정 이력을 불러오지 못했습니다.") : NextResponse.json({ revisions: data ?? [] });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.supabase.rpc("set_log_entry_deleted_v3", { target_page_id: id, target_entry_id: entryId, should_delete: true });
  return error ? databaseErrorResponse(error, "로그 블록을 삭제하지 못했습니다.") : NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) });
}
