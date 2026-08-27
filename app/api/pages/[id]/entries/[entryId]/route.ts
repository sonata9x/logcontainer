import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { replaceTextPreservingMarkup } from "@/lib/logs/html";
import { projectDocumentText } from "@/lib/logs/model/projection";
import { validateLogEntryDocument } from "@/lib/logs/model/validate";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).maybeSingle();
  if (!log) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const { data: entry } = await context.supabase.from("log_entries").select("id, raw_html, document_version, document").eq("id", entryId).eq("log_id", log.id).maybeSingle();
  if (!entry) return NextResponse.json({ error: "블록을 찾을 수 없습니다." }, { status: 404 });

  if (entry.document_version === 2) {
    const validated = validateLogEntryDocument(body.document);
    if (!validated.ok) return NextResponse.json({ error: validated.error ?? "문서 구조가 올바르지 않습니다." }, { status: 400 });
    const content = projectDocumentText(validated.document);
    const { data, error } = await context.supabase.rpc("update_log_entry_document_v2", {
      target_page_id: id, target_entry_id: entryId, next_document: validated.document, next_content: content,
      revision_action: body.revisionAction === "revert" ? "revert" : "edit",
      expected_updated_at: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null
    });
    return error ? NextResponse.json({ error: error.code === "40001" ? "다른 멤버가 먼저 수정했습니다. 새로고침 후 다시 시도해주세요." : error.message }, { status: error.code === "40001" ? 409 : 400 }) : NextResponse.json(data);
  }
  if (typeof body.content !== "string") return NextResponse.json({ error: "수정할 내용이 없습니다." }, { status: 400 });

  const { data, error } = await context.supabase.rpc("update_log_entry_content", {
    target_page_id: id,
    target_entry_id: entryId,
    next_content: body.content,
    next_raw_html: replaceTextPreservingMarkup(entry.raw_html, body.content),
    revision_action: body.revisionAction === "revert" ? "revert" : "edit",
    expected_updated_at: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null
  });
  return error ? NextResponse.json({ error: error.code === "40001" ? "다른 멤버가 먼저 수정했습니다. 새로고침 후 다시 시도해주세요." : error.message }, { status: error.code === "40001" ? 409 : 400 }) : NextResponse.json(data);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const { data, error } = await context.supabase.from("log_entry_revisions").select("*").eq("entry_id", entryId).order("created_at", { ascending: false }).limit(50);
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ revisions: data ?? [] });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).maybeSingle();
  const { data: entry } = log ? await context.supabase.from("log_entries").select("document_version").eq("id", entryId).eq("log_id", log.id).maybeSingle() : { data: null };
  const { data, error } = await context.supabase.rpc(entry?.document_version === 2 ? "set_log_entry_deleted_v2" : "set_log_entry_deleted", { target_page_id: id, target_entry_id: entryId, should_delete: true });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}
