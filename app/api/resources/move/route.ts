import { NextResponse } from "next/server";
import { getAuthenticatedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(request: Request) {
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const resourceIds = Array.isArray(body.resourceIds)
    ? body.resourceIds.filter((value: unknown): value is string => typeof value === "string").slice(0, 101)
    : [];
  const targetFolderId = typeof body.targetFolderId === "string" && body.targetFolderId ? body.targetFolderId : null;
  const scope = body.scope === "personal" || body.scope === "shared" ? body.scope : null;
  if (body.scope != null && !scope) return NextResponse.json({ error: "올바른 이동 범위를 선택해주세요." }, { status: 400 });
  if (!resourceIds.length || resourceIds.length > 100) {
    return NextResponse.json({ error: "이동할 리소스는 1~100개까지 선택할 수 있습니다." }, { status: 400 });
  }
  const { data, error } = await context.supabase.rpc("move_resources_scoped_v1", {
    target_resource_ids: resourceIds,
    target_folder_id: targetFolderId,
    move_scope: scope
  });
  if (error?.code === "PGRST202" || error?.code === "42883" || (error && /schema cache/i.test(error.message))) {
    return NextResponse.json({ error: "새 리소스 이동 DB 마이그레이션이 필요합니다." }, { status: 503 });
  }
  return error ? databaseErrorResponse(error, "리소스를 이동하지 못했습니다.") : NextResponse.json(data);
}
