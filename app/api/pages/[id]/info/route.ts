import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log") return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const { data: log, error } = await context.supabase.from("logs").select("id, platform, updated_at").eq("page_id", id).maybeSingle();
  if (error) return databaseErrorResponse(error, "로그 정보를 불러오지 못했습니다.");
  if (!log) return NextResponse.json({ error: "로그를 찾을 수 없습니다." }, { status: 404 });
  const { data: latestImport } = await context.supabase.from("log_imports").select("created_at").eq("log_id", log.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({ platform: log.platform, updatedAt: log.updated_at, latestImportAt: latestImport?.created_at ?? null });
}
