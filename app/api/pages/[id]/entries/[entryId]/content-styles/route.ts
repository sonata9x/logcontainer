import { NextResponse } from "next/server";
import { getAuthenticatedApiContext } from "@/lib/api-auth";
import { styleToEditorText } from "@/lib/logs/model/editor";
import { contentStyleMap, styledContentTargets } from "@/lib/logs/model/user-edit";
import { isStoredLogEntryDocumentV2 } from "@/lib/logs/model/validate";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data: entry } = await context.supabase.rpc("get_log_entry_edit_source", { target_page_id: id, target_entry_id: entryId });
  if (!entry || entry.document_version !== 2 || !isStoredLogEntryDocumentV2(entry.document)) return NextResponse.json({ error: "블록을 찾을 수 없습니다." }, { status: 404 });
  const original = isStoredLogEntryDocumentV2(entry.original_document) ? entry.original_document : entry.document;
  if (original.source.platform !== "roll20") return NextResponse.json({ styles: [] });
  const currentStyles = contentStyleMap(entry.document);
  const styles = styledContentTargets(original).map((target) => ({
    id: target.id,
    label: target.label,
    css: styleToEditorText(currentStyles.get(target.id) ?? target.style)
  }));
  return NextResponse.json({ styles });
}
