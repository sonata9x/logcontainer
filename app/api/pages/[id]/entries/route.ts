import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { createManualLogEntryDocument } from "@/lib/logs/model/factory";
import { projectDocumentText } from "@/lib/logs/model/projection";
import { toLogEntryDto } from "@/lib/logs/dto";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const value = new URL(request.url).searchParams.get("after");
  const after = value && /^\d+$/.test(value) ? Number(value) : null;
  const { data, error } = await context.supabase.rpc("get_log_entries_page", { target_page_id: id, after_sort_key: after, batch_size: 200 });
  if (error) return databaseErrorResponse(error, "로그를 불러오지 못했습니다.");
  const result = data as { entries?: Record<string, unknown>[]; totalCount?: number; batchSize?: number } | null;
  return NextResponse.json({ ...result, entries: (result?.entries ?? []).map(toLogEntryDto) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const speakerName = typeof body.speakerName === "string" ? body.speakerName.trim().slice(0, 100) : "";
  const entryType = body.entryType === "system" ? "description" : "dialogue";
  const afterEntryId = typeof body.afterEntryId === "string" ? body.afterEntryId : null;
  if (!content) return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });

  const document = createManualLogEntryDocument(entryType, speakerName || null, content);
  const { data, error } = await context.supabase.rpc("create_log_entry_v3", {
    target_page_id: id,
    after_entry_id: afterEntryId,
    new_document: document,
    new_content: projectDocumentText(document)
  });
  return error ? databaseErrorResponse(error, "로그 블록을 만들지 못했습니다.") : NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>) }, { status: 201 });
}
