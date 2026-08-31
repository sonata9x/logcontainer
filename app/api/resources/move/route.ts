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
  const { data: bulkResult, error: bulkError } = await context.supabase.rpc("move_resources_bulk", {
    target_resource_ids: resourceIds,
    target_folder_id: targetFolderId
  });
  if (!bulkError) return NextResponse.json(bulkResult);
  const missingBulkRpc = bulkError.code === "PGRST202" || bulkError.code === "42883" || /schema cache/i.test(bulkError.message);
  if (!missingBulkRpc) return databaseErrorResponse(bulkError, "리소스를 이동하지 못했습니다.");

  // Some hosts deploy application code before the additive SQL migration. Keep
  // movement working there by composing the already-established placement RPCs.
  const { data: folderRows, error: folderReadError } = await context.supabase
    .from("folder_items").select("child_resource_id, folder_id").in("child_resource_id", resourceIds);
  if (folderReadError) return databaseErrorResponse(folderReadError, "현재 리소스 위치를 확인하지 못했습니다.");
  const sourceFolderByResource = new Map((folderRows ?? []).map((row) => [row.child_resource_id, row.folder_id]));

  for (const [orderIndex, resourceId] of resourceIds.entries()) {
    const sourceFolderId = sourceFolderByResource.get(resourceId) ?? null;
    if (sourceFolderId && sourceFolderId === targetFolderId) continue;

    if (sourceFolderId && targetFolderId) {
      const { error } = await context.supabase.rpc("insert_folder_item", {
        target_folder_id: targetFolderId,
        target_child_resource_id: resourceId,
        target_order: orderIndex
      });
      if (error) return databaseErrorResponse(error, "공유 폴더 구조에서 리소스를 이동하지 못했습니다.");
      continue;
    }

    if (sourceFolderId) {
      const { error } = await context.supabase.rpc("remove_folder_item", {
        target_folder_id: sourceFolderId,
        target_child_resource_id: resourceId
      });
      if (error) return databaseErrorResponse(error, "공유 폴더에서 리소스를 꺼내지 못했습니다.");
    }

    const { error } = await context.supabase.rpc("move_workspace_item", {
      target_resource_id: resourceId,
      target_parent_local_resource_id: targetFolderId,
      target_order: orderIndex
    });
    if (error) return databaseErrorResponse(error, "개인 목록에서 리소스를 이동하지 못했습니다.");
  }

  return NextResponse.json({ movedCount: resourceIds.length, targetFolderId });
}
