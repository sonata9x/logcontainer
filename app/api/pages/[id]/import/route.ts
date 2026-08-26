import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { importRoll20Html } from "@/lib/logs/import";
import { sanitizeLogHtml } from "@/lib/logs/html";

const MAX_SOURCE_SIZE = 25 * 1024 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log") return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const source = typeof body.source === "string" ? body.source : "";
  if (!source.trim()) return NextResponse.json({ error: "가져올 HTML이 없습니다." }, { status: 400 });
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_SIZE) return NextResponse.json({ error: "HTML은 최대 25MB까지 가져올 수 있습니다." }, { status: 413 });

  let imported;
  try {
    imported = importRoll20Html(source, {
      removeHiddenMessages: body.removeHiddenMessages === true,
      removeDuplicateMessages: body.removeDuplicateMessages === true
    });
  } catch {
    return NextResponse.json({ error: "Roll20 msgdata 또는 .message 요소가 있는 HTML만 가져올 수 있습니다." }, { status: 400 });
  }
  if (!imported.entries.length) return NextResponse.json({ error: "메시지 블록을 찾지 못했습니다." }, { status: 400 });

  const safeEntries = imported.entries.map((entry) => ({
    ...entry,
    raw_html: entry.raw_html ? sanitizeLogHtml(entry.raw_html) : null
  }));

  const { data, error } = await context.supabase.rpc("replace_log_entries", {
    target_page_id: id,
    source_html: source,
    source_platform: imported.platform,
    report: imported.report,
    entries: safeEntries
  });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ count: data, report: imported.report });
}
