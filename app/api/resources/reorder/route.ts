import { NextResponse } from "next/server";
import { getAuthenticatedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const relation = body.relation === "folder" ? "folder" : body.relation === "workspace" ? "workspace" : null;
  const parentId = typeof body.parentId === "string" && UUID.test(body.parentId) ? body.parentId : null;
  const orderedIds: unknown[] = Array.isArray(body.orderedIds) ? body.orderedIds : [];
  const expected: unknown[] = Array.isArray(body.expected) ? body.expected : [];
  if (!relation || (relation === "folder" && !parentId) || orderedIds.length < 2 || orderedIds.length > 500 || expected.length !== orderedIds.length) {
    return NextResponse.json({ error: "순서를 바꿀 사이드바 범위가 올바르지 않습니다." }, { status: 400 });
  }
  if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some((value) => typeof value !== "string" || !UUID.test(value))) {
    return NextResponse.json({ error: "중복되거나 올바르지 않은 리소스 ID입니다." }, { status: 400 });
  }
  const expectedIds: string[] = [];
  const expectedOrderIndices: number[] = [];
  for (const item of expected) {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : null;
    if (!value || typeof value.id !== "string" || !UUID.test(value.id) || !Number.isSafeInteger(value.orderIndex) || typeof value.orderIndex !== "number" || value.orderIndex < 0) {
      return NextResponse.json({ error: "사이드바 순서 기준값이 올바르지 않습니다." }, { status: 400 });
    }
    expectedIds.push(value.id);
    expectedOrderIndices.push(value.orderIndex);
  }
  if (new Set(expectedIds).size !== expectedIds.length || orderedIds.some((resourceId) => !expectedIds.includes(resourceId as string))) {
    return NextResponse.json({ error: "순서 변경 대상이 일치하지 않습니다." }, { status: 400 });
  }
  const { data, error } = await context.supabase.rpc("reorder_resources_v1", {
    target_relation: relation,
    target_parent_id: parentId,
    ordered_resource_ids: orderedIds as string[],
    expected_resource_ids: expectedIds,
    expected_order_indices: expectedOrderIndices
  });
  if (error?.code === "40001") return NextResponse.json({ error: "다른 멤버가 먼저 목록을 변경했습니다. 다시 시도해주세요." }, { status: 409 });
  if (!error) return NextResponse.json(data);
  const missingReorderRpc = error.code === "PGRST202" || error.code === "42883" || /schema cache/i.test(error.message);
  if (!missingReorderRpc) return databaseErrorResponse(error, "사이드바 순서를 저장하지 못했습니다.");

  // Keep ordering usable while application deploys race the additive migration.
  // The dedicated RPC above remains the atomic path once the migration is present.
  for (const [orderIndex, resourceId] of (orderedIds as string[]).entries()) {
    const { error: fallbackError } = relation === "workspace"
      ? await context.supabase.rpc("move_workspace_item", {
          target_resource_id: resourceId,
          target_parent_local_resource_id: parentId,
          target_order: orderIndex
        })
      : await context.supabase.rpc("insert_folder_item", {
          target_folder_id: parentId,
          target_child_resource_id: resourceId,
          target_order: orderIndex
        });
    if (fallbackError) return databaseErrorResponse(fallbackError, "사이드바 순서를 저장하지 못했습니다.");
  }
  return NextResponse.json({ relation, parentId, movedCount: orderedIds.length, fallback: true });
}
