import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context) return NextResponse.json({ error: "로그를 찾지 못했습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "플레이리스트 이름을 입력해주세요." }, { status: 400 });
  const { data: playlist, error } = await context.supabase.from("bgm_playlists").upsert({ user_id: context.user.id, source_page_id: id, title }, { onConflict: "user_id,source_page_id" }).select("id, title, source_page_id").single();
  if (error) return databaseErrorResponse(error, "연동 플레이리스트를 만들지 못했습니다.");
  const { data: usages } = await context.supabase.from("page_bgm_items").select("bgm_asset_id, custom_title, sort_order").eq("page_id", id).order("sort_order");
  if (usages?.length) {
    const { error: itemError } = await context.supabase.from("bgm_playlist_items").upsert(usages.map((item, index) => ({ playlist_id: playlist.id, bgm_asset_id: item.bgm_asset_id, custom_title: item.custom_title, sort_order: index })), { onConflict: "playlist_id,bgm_asset_id", ignoreDuplicates: true });
    if (itemError) return databaseErrorResponse(itemError, "페이지 BGM을 플레이리스트에 복사하지 못했습니다.");
  }
  return NextResponse.json({ playlist }, { status: 201 });
}
