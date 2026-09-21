import { NextResponse } from "next/server";
import { getApprovedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

async function ownsPlaylist(context: NonNullable<Awaited<ReturnType<typeof getApprovedApiContext>>>, playlistId: string) {
  const { data } = await context.supabase.from("bgm_playlists").select("id").eq("id", playlistId).eq("user_id", context.user.id).maybeSingle();
  return Boolean(data);
}

export async function POST(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const playlistId = typeof body.playlistId === "string" ? body.playlistId : "";
  const assetIds = [...new Set((Array.isArray(body.assetIds) ? body.assetIds : [body.assetId]).filter((id: unknown): id is string => typeof id === "string" && Boolean(id)))];
  if (!playlistId || !assetIds.length || assetIds.length > 500 || !(await ownsPlaylist(context, playlistId))) return NextResponse.json({ error: "플레이리스트와 곡을 확인해주세요." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("add_bgm_playlist_items", { target_playlist_id: playlistId, target_asset_ids: assetIds });
  return error ? databaseErrorResponse(error, "곡을 추가하지 못했습니다.") : NextResponse.json({ ok: true, ...data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const playlistId = typeof body.playlistId === "string" ? body.playlistId : "";
  if (!playlistId || !(await ownsPlaylist(context, playlistId))) return NextResponse.json({ error: "플레이리스트를 찾지 못했습니다." }, { status: 404 });
  if (Array.isArray(body.itemIds)) {
    const ids = body.itemIds.filter((id: unknown): id is string => typeof id === "string" && Boolean(id));
    const { error } = await context.supabase.rpc("reorder_bgm_playlist_items", { target_playlist_id: playlistId, target_item_ids: ids });
    return error ? databaseErrorResponse(error, "곡 순서를 저장하지 못했습니다.") : NextResponse.json({ ok: true });
  }
  const id = typeof body.id === "string" ? body.id : "";
  const customTitle = typeof body.customTitle === "string" ? body.customTitle.trim().slice(0, 200) || null : null;
  const { error } = await context.supabase.from("bgm_playlist_items").update({ custom_title: customTitle }).eq("id", id).eq("playlist_id", playlistId);
  return error ? databaseErrorResponse(error, "곡 이름을 바꾸지 못했습니다.") : NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const playlistId = url.searchParams.get("playlistId") ?? "";
  if (!id || !playlistId || !(await ownsPlaylist(context, playlistId))) return NextResponse.json({ error: "플레이리스트를 찾지 못했습니다." }, { status: 404 });
  const { error } = await context.supabase.from("bgm_playlist_items").delete().eq("id", id).eq("playlist_id", playlistId);
  return error ? databaseErrorResponse(error, "곡을 제거하지 못했습니다.") : NextResponse.json({ ok: true });
}
