import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { styleToEditorText } from "@/lib/logs/model/editor";
import { contentStyleMap, styledContentTargets } from "@/lib/logs/model/user-edit";
import { isStoredLogEntryDocumentV2 } from "@/lib/logs/model/validate";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).maybeSingle();
  const { data: entry } = log ? await context.supabase.from("log_entries")
    .select("document, original_document, document_version")
    .eq("id", entryId).eq("log_id", log.id).eq("is_deleted", false).maybeSingle() : { data: null };
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
