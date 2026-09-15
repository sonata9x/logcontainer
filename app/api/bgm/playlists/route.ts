import { NextResponse } from "next/server";
import { getApprovedApiContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { BGM_ASSET_SELECT, oneBgmAsset } from "@/lib/bgm";

const ITEM_SELECT = `id, playlist_id, bgm_asset_id, custom_title, sort_order, asset:bgm_assets(${BGM_ASSET_SELECT})`;

export async function GET() {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data: playlists, error } = await context.supabase.from("bgm_playlists").select("id, title, source_page_id, created_at, updated_at").eq("user_id", context.user.id).order("updated_at", { ascending: false });
  if (error) return databaseErrorResponse(error, "플레이리스트를 불러오지 못했습니다.");
  const ids = (playlists ?? []).map((playlist) => playlist.id);
  const { data: items, error: itemsError } = ids.length ? await context.supabase.from("bgm_playlist_items").select(ITEM_SELECT).in("playlist_id", ids).order("sort_order").order("created_at") : { data: [], error: null };
  if (itemsError) return databaseErrorResponse(itemsError, "플레이리스트 곡을 불러오지 못했습니다.");
  const normalized = (items ?? []).map((item) => ({ ...item, asset: oneBgmAsset(item.asset) })).filter((item) => item.asset);
  return NextResponse.json({ playlists: (playlists ?? []).map((playlist) => ({ ...playlist, items: normalized.filter((item) => item.playlist_id === playlist.id) })) });
}

export async function POST(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "플레이리스트 이름을 입력해주세요." }, { status: 400 });
  const { data, error } = await context.supabase.from("bgm_playlists").insert({ user_id: context.user.id, title }).select("id, title, source_page_id, created_at, updated_at").single();
  return error ? databaseErrorResponse(error, "플레이리스트를 만들지 못했습니다.") : NextResponse.json({ playlist: { ...data, items: [] } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!id || !title) return NextResponse.json({ error: "플레이리스트와 이름을 확인해주세요." }, { status: 400 });
  const { error } = await context.supabase.from("bgm_playlists").update({ title }).eq("id", id).eq("user_id", context.user.id);
  return error ? databaseErrorResponse(error, "플레이리스트 이름을 바꾸지 못했습니다.") : NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "플레이리스트를 선택해주세요." }, { status: 400 });
  const { error } = await context.supabase.from("bgm_playlists").delete().eq("id", id).eq("user_id", context.user.id);
  return error ? databaseErrorResponse(error, "플레이리스트를 삭제하지 못했습니다.") : NextResponse.json({ ok: true });
}
