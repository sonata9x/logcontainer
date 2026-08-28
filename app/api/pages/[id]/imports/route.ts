import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "페이지를 찾을 수 없습니다." }, { status: 404 });
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).maybeSingle();
  if (!log) return NextResponse.json({ imports: [] });
  const { data, error } = await context.supabase.from("log_imports").select("id, report, imported_by, created_at").eq("log_id", log.id).order("created_at", { ascending: false }).limit(100);
  return error ? databaseErrorResponse(error, "가져오기 이력을 불러오지 못했습니다.") : NextResponse.json({ imports: data ?? [] });
}
