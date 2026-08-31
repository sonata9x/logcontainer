import { NextResponse } from "next/server";
import { getAuthenticatedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getAuthenticatedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const orderedValues: unknown[] = Array.isArray(body.orderedIds) ? body.orderedIds : [];
  const expected: unknown[] = Array.isArray(body.expected) ? body.expected : [];
  if (orderedValues.length < 2 || orderedValues.length > 500 || expected.length !== orderedValues.length) {
    return NextResponse.json({ error: "순서를 바꿀 메시지 범위가 올바르지 않습니다." }, { status: 400 });
  }
  if (new Set(orderedValues).size !== orderedValues.length || orderedValues.some((value) => typeof value !== "string" || !UUID.test(value))) {
    return NextResponse.json({ error: "중복되거나 올바르지 않은 메시지 ID입니다." }, { status: 400 });
  }
  const expectedIds: string[] = [];
  const expectedSortKeys: number[] = [];
  for (const item of expected) {
    const value = item && typeof item === "object" ? item as Record<string, unknown> : null;
    if (!value || typeof value.id !== "string" || !UUID.test(value.id) || !Number.isSafeInteger(value.sortKey) || typeof value.sortKey !== "number" || value.sortKey < 0) {
      return NextResponse.json({ error: "메시지 순서 기준값이 올바르지 않습니다." }, { status: 400 });
    }
    expectedIds.push(value.id);
    expectedSortKeys.push(value.sortKey);
  }
  const orderedIds = orderedValues as string[];
  if (new Set(expectedIds).size !== expectedIds.length || orderedIds.some((entryId) => !expectedIds.includes(entryId))) {
    return NextResponse.json({ error: "순서 변경 대상이 일치하지 않습니다." }, { status: 400 });
  }
  const { data, error } = await context.supabase.rpc("reorder_log_entries_v1", {
    target_page_id: id,
    ordered_entry_ids: orderedIds,
    expected_entry_ids: expectedIds,
    expected_sort_keys: expectedSortKeys
  });
  if (error?.code === "40001") return NextResponse.json({ error: "다른 멤버가 먼저 순서를 변경했습니다. 새로고침 후 다시 시도해주세요." }, { status: 409 });
  return error ? databaseErrorResponse(error, "메시지 순서를 저장하지 못했습니다.") : NextResponse.json(data);
}
