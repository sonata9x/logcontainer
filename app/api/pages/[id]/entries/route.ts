import { NextResponse } from "next/server";
import { getAuthenticatedApiContext } from "@/lib/api-auth";
import { createManualLogEntryDocument, createManualStyledLogEntryDocument } from "@/lib/logs/model/factory";
import { projectDocumentText } from "@/lib/logs/model/projection";
import { sanitizeRichStyle } from "@/lib/logs/rich/style";
import { toLogEntryDto } from "@/lib/logs/dto";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const startedAt = performance.now();
  const { id } = await params;
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const authAt = performance.now();
  const value = new URL(request.url).searchParams.get("after");
  const after = value && /^\d+$/.test(value) ? Number(value) : null;
  const { data, error } = await context.supabase.rpc("get_log_entries_page", { target_page_id: id, after_sort_key: after, batch_size: 50 });
  if (error) return databaseErrorResponse(error, "로그를 불러오지 못했습니다.");
  const result = data as { entries?: Record<string, unknown>[]; totalCount?: number; batchSize?: number } | null;
  const completedAt = performance.now();
  return NextResponse.json({ ...result, entries: (result?.entries ?? []).map(toLogEntryDto) }, { headers: { "Server-Timing": `auth;dur=${(authAt - startedAt).toFixed(1)}, db;dur=${(completedAt - authAt).toFixed(1)}, total;dur=${(completedAt - startedAt).toFixed(1)}` } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const content = typeof body.content === "string" ? body.content.trim() : "";
  const speakerName = typeof body.speakerName === "string" ? body.speakerName.trim().slice(0, 100) : "";
  const entryType = body.entryType === "system" ? "description" : "dialogue";
  const afterEntryId = typeof body.afterEntryId === "string" ? body.afterEntryId : null;
  const rawSegments: unknown[] = Array.isArray(body.segments) ? body.segments : [];
  if (rawSegments.length > 20) return NextResponse.json({ error: "한 블록에는 CSS 구간을 최대 20개까지 추가할 수 있습니다." }, { status: 400 });
  const styleWarnings: string[] = [];
  const segments = rawSegments.flatMap((value) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    const text = typeof item.text === "string" ? item.text : "";
    const css = typeof item.css === "string" ? item.css : "";
    if (text.length > 200_000 || css.length > 20_000) return [];
    const sanitized = sanitizeRichStyle(css);
    styleWarnings.push(...sanitized.warnings);
    return text ? [{ text, style: sanitized.style }] : [];
  });
  if (!content && !segments.length) return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });

  const document = segments.length
    ? createManualStyledLogEntryDocument(entryType, speakerName || null, segments)
    : createManualLogEntryDocument(entryType, speakerName || null, content);
  const { data, error } = await context.supabase.rpc("create_log_entry_v3", {
    target_page_id: id,
    after_entry_id: afterEntryId,
    new_document: document,
    new_content: projectDocumentText(document)
  });
  return error ? databaseErrorResponse(error, "로그 블록을 만들지 못했습니다.") : NextResponse.json({ entry: toLogEntryDto(data as Record<string, unknown>), styleWarnings }, { status: 201 });
}
