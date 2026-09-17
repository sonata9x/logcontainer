import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { BGM_ASSET_SELECT, oneBgmAsset } from "@/lib/bgm";

const SELECT = `id, page_id, bgm_asset_id, role, entry_id, sort_order, custom_title, created_at, asset:bgm_assets(${BGM_ASSET_SELECT})`;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log") return NextResponse.json({ error: "로그를 찾지 못했습니다." }, { status: 404 });
  const { data, error } = await context.supabase.from("page_bgm_items").select(SELECT).eq("page_id", id).order("role").order("sort_order").order("created_at");
  if (error) return databaseErrorResponse(error, "페이지 BGM을 불러오지 못했습니다.");
  return NextResponse.json({ items: (data ?? []).map((item) => ({ ...item, asset: oneBgmAsset(item.asset) })).filter((item) => item.asset) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "BGM 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const assetId = typeof body.assetId === "string" ? body.assetId : "";
  const role = body.role === "entry" ? "entry" : "waiting";
  const entryId = role === "entry" && typeof body.entryId === "string" ? body.entryId : null;
  if (!assetId || (role === "entry" && !entryId)) return NextResponse.json({ error: "BGM 대상이 올바르지 않습니다." }, { status: 400 });
  if (role === "waiting") {
    const { data, error } = await context.supabase.rpc("set_page_waiting_bgm", {
      target_page_id: id, target_asset_id: assetId,
      target_custom_title: typeof body.customTitle === "string" ? body.customTitle.trim().slice(0, 200) || null : null
    });
    if (error) return databaseErrorResponse(error, "대기 BGM을 변경하지 못했습니다.");
    return NextResponse.json({ item: data }, { status: 201 });
  }
  if (entryId) {
    const { data: entry } = await context.supabase.from("log_entries").select("id, logs!inner(page_id)").eq("id", entryId).eq("logs.page_id", id).maybeSingle();
    if (!entry) return NextResponse.json({ error: "이 페이지의 로그 메시지가 아닙니다." }, { status: 400 });
  }
  const { data: last } = await context.supabase.from("page_bgm_items").select("sort_order").eq("page_id", id).eq("role", role).order("sort_order", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await context.supabase.from("page_bgm_items").insert({ page_id: id, bgm_asset_id: assetId, role, entry_id: entryId, sort_order: (last?.sort_order ?? -1) + 1, custom_title: typeof body.customTitle === "string" ? body.customTitle.trim().slice(0, 200) || null : null, created_by: context.user.id }).select(SELECT).single();
  if (error) return databaseErrorResponse(error, "페이지에 BGM을 추가하지 못했습니다.");
  if (role === "entry" && entryId) await context.supabase.from("page_bgm_items").delete().eq("page_id", id).eq("role", "entry").eq("entry_id", entryId).neq("id", data.id);
  return NextResponse.json({ item: { ...data, asset: oneBgmAsset(data.asset) } }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit) return NextResponse.json({ error: "BGM 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  const customTitle = typeof body.customTitle === "string" ? body.customTitle.trim().slice(0, 200) || null : null;
  const { error } = await context.supabase.from("page_bgm_items").update({ custom_title: customTitle }).eq("id", itemId).eq("page_id", id);
  return error ? databaseErrorResponse(error, "BGM 이름을 바꾸지 못했습니다.") : NextResponse.json({ ok: true });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit) return NextResponse.json({ error: "BGM 수정 권한이 없습니다." }, { status: 403 });
  const itemId = new URL(request.url).searchParams.get("itemId");
  if (!itemId) return NextResponse.json({ error: "BGM을 선택해주세요." }, { status: 400 });
  const { error } = await context.supabase.from("page_bgm_items").delete().eq("id", itemId).eq("page_id", id);
  return error ? databaseErrorResponse(error, "BGM을 제거하지 못했습니다.") : NextResponse.json({ ok: true });
}
