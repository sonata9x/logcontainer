import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { buildNewEntryHtml } from "@/lib/logs/html";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const speakerName = typeof body.speakerName === "string" ? body.speakerName.trim().slice(0, 100) : "";
  const entryType = body.entryType === "system" ? "system" : "dialogue";
  const afterEntryId = typeof body.afterEntryId === "string" ? body.afterEntryId : null;
  if (!content) return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });

  const { data, error } = await context.supabase.rpc("create_log_entry", {
    target_page_id: id,
    after_entry_id: afterEntryId,
    new_entry_type: entryType,
    new_speaker_name: speakerName,
    new_content: content,
    new_raw_html: buildNewEntryHtml(entryType, speakerName, content)
  });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data, { status: 201 });
}
