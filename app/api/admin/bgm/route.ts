import { NextResponse } from "next/server";
import { getSiteAdminApiContext } from "@/lib/admin-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { BGM_AUDIO_BUCKET } from "@/lib/bgm";
import { BGM_USAGE_FILTERS } from "@/lib/bgm-admin";

export async function GET(request: Request) {
  const context = await getSiteAdminApiContext();
  if (!context) return NextResponse.json({ error: "사이트 관리자만 접근할 수 있습니다." }, { status: 403 });
  const url = new URL(request.url);
  const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
  const filter = url.searchParams.get("usage") ?? "all";
  if (!BGM_USAGE_FILTERS.some((item) => item.value === filter)) return NextResponse.json({ error: "올바르지 않은 필터입니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("admin_bgm_inventory", { search_text: (url.searchParams.get("search") ?? "").slice(0, 200), page_offset: Math.min(offset, 2_000_000_000), usage_filter: filter });
  return error ? databaseErrorResponse(error, "BGM 목록을 불러오지 못했습니다.") : NextResponse.json(data, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request) {
  const context = await getSiteAdminApiContext();
  if (!context) return NextResponse.json({ error: "사이트 관리자만 삭제할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.assetId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.assetId) || body.confirm !== "PERMANENTLY_DELETE") return NextResponse.json({ error: "영구 삭제 확인이 필요합니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("prepare_admin_bgm_delete", { target_asset_id: body.assetId });
  if (error) return databaseErrorResponse(error, "삭제를 준비하지 못했습니다. 업로드 후 24시간 이내의 파일은 보호됩니다.");
  // The tombstone remains discoverable if either Storage or final DB deletion
  // fails. Its references have been detached transactionally; retry is safe.
  const asset = data as { id: string; storagePath: string | null };
  if (asset.storagePath) {
    const { error: storageError } = await context.admin.storage.from(BGM_AUDIO_BUCKET).remove([asset.storagePath]);
    if (storageError) return NextResponse.json({ error: "연결은 해제됐지만 Storage 삭제에 실패했습니다. 목록을 새로고침한 뒤 다시 삭제해주세요." }, { status: 502 });
  }
  const { error: deleteError } = await context.admin.from("bgm_assets").delete().eq("id", asset.id).not("deleted_at", "is", null);
  return deleteError ? databaseErrorResponse(deleteError, "파일은 삭제됐지만 메타데이터 정리가 실패했습니다. 다시 삭제해주세요.") : NextResponse.json({ ok: true });
}
