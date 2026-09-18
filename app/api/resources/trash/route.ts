import { NextResponse } from "next/server";
import { getApiWorkspaceContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { drainStorageDeletionQueue } from "@/lib/storage-cleanup";

export async function GET() {
  const context = await getApiWorkspaceContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.supabase.from("pages").select("id, page_type, title, deleted_at, purge_after").eq("original_owner_id", context.user.id).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  return error ? databaseErrorResponse(error, "휴지통을 불러오지 못했습니다.") : NextResponse.json({ resources: data ?? [] });
}

export async function POST(request: Request) {
  const context = await getApiWorkspaceContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const rpc = body.permanent === true ? "permanently_delete_resource" : "restore_resource";
  const { data, error } = await context.supabase.rpc(rpc, { target_resource_id: body.resourceId });
  if (error) return databaseErrorResponse(error, "휴지통 작업을 완료하지 못했습니다.");
  if (body.permanent === true) await drainStorageDeletionQueue(createSupabaseAdminClient()).catch(() => {});
  return NextResponse.json(data);
}

export async function DELETE(request: Request) {
  const context = await getApiWorkspaceContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (body.confirm !== "EMPTY_TRASH") return NextResponse.json({ error: "휴지통 비우기 확인이 필요합니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("empty_resource_trash");
  if (error) return databaseErrorResponse(error, "휴지통을 비우지 못했습니다.");
  await drainStorageDeletionQueue(createSupabaseAdminClient()).catch(() => {});
  return NextResponse.json({ removed: data ?? 0 });
}
