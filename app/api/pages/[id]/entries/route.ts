import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { createManualLogEntryDocument } from "@/lib/logs/model/factory";
import { projectDocumentText } from "@/lib/logs/model/projection";

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
  const { data, error } = await context.supabase.rpc("create_log_entry_v2", {
    target_page_id: id,
    after_entry_id: afterEntryId,
    new_document: document,
    new_content: projectDocumentText(document)
  });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data, { status: 201 });
}
