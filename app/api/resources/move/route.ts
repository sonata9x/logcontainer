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
  if (!resourceIds.length || resourceIds.length > 100) {
    return NextResponse.json({ error: "이동할 리소스는 1~100개까지 선택할 수 있습니다." }, { status: 400 });
  }
  const { data, error } = await context.supabase.rpc("move_resources_bulk", {
    target_resource_ids: resourceIds,
    target_folder_id: targetFolderId
  });
  return error ? databaseErrorResponse(error, "리소스를 이동하지 못했습니다.") : NextResponse.json(data);
}
