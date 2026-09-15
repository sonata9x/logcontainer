import { NextRequest, NextResponse } from "next/server";
import { getApprovedApiContext } from "@/lib/api-auth";
import { BGM_ASSET_SELECT, oneBgmAsset, parseYouTubeVideoId } from "@/lib/bgm";
import { databaseErrorResponse } from "@/lib/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPublicationAccess, PUBLICATION_SESSION_COOKIE } from "@/lib/publication-auth";

const SELECT = `id, bgm_asset_id, custom_title, created_at, asset:bgm_assets(${BGM_ASSET_SELECT})`;

export async function GET() {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.supabase.from("bgm_library_items").select(SELECT).eq("user_id", context.user.id).order("created_at", { ascending: false });
  if (error) return databaseErrorResponse(error, "BGM 보관함을 불러오지 못했습니다.");
  return NextResponse.json({ items: (data ?? []).map((item) => ({ ...item, asset: oneBgmAsset(item.asset) })).filter((item) => item.asset) });
}

export async function POST(request: NextRequest) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  let assetId = typeof body.assetId === "string" ? body.assetId : null;
  if (!assetId) {
    const videoId = parseYouTubeVideoId(body.youtubeUrl);
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    if (!videoId || !title) return NextResponse.json({ error: "YouTube 주소와 제목을 확인해주세요." }, { status: 400 });
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const { data: asset, error: assetError } = await context.supabase.from("bgm_assets").insert({ owner_user_id: context.user.id, source_type: "youtube", youtube_url: canonicalUrl, youtube_video_id: videoId, canonical_title: title, is_ready: true }).select("id").single();
    if (assetError) return databaseErrorResponse(assetError, "YouTube BGM을 저장하지 못했습니다.");
    assetId = asset.id;
  } else if (typeof body.publicationToken === "string") {
    const publication = await getPublicationAccess(body.publicationToken, request.cookies.get(PUBLICATION_SESSION_COOKIE)?.value);
    const admin = createSupabaseAdminClient();
    const { data: usage } = publication?.authorized ? await admin.from("page_bgm_items").select("id").eq("page_id", publication.page.id).eq("bgm_asset_id", assetId).limit(1).maybeSingle() : { data: null };
    if (!usage) return NextResponse.json({ error: "공개 페이지에서 사용 중인 BGM이 아닙니다." }, { status: 403 });
    const { error } = await admin.from("bgm_library_items").upsert({ user_id: context.user.id, bgm_asset_id: assetId, custom_title: typeof body.title === "string" ? body.title.trim().slice(0, 200) || null : null }, { onConflict: "user_id,bgm_asset_id" });
    return error ? databaseErrorResponse(error, "BGM을 보관함에 추가하지 못했습니다.") : NextResponse.json({ ok: true }, { status: 201 });
  }
  const customTitle = typeof body.customTitle === "string" ? body.customTitle.trim().slice(0, 200) || null : null;
  const { error } = await context.supabase.from("bgm_library_items").upsert({ user_id: context.user.id, bgm_asset_id: assetId, custom_title: customTitle }, { onConflict: "user_id,bgm_asset_id" });
  return error ? databaseErrorResponse(error, "BGM을 보관함에 추가하지 못했습니다.") : NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const customTitle = typeof body.title === "string" ? body.title.trim().slice(0, 200) || null : null;
  const { error } = await context.supabase.from("bgm_library_items").update({ custom_title: customTitle }).eq("id", id).eq("user_id", context.user.id);
  return error ? databaseErrorResponse(error, "BGM 이름을 바꾸지 못했습니다.") : NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "BGM을 선택해주세요." }, { status: 400 });
  const { data: item } = await context.supabase.from("bgm_library_items").select("bgm_asset_id").eq("id", id).eq("user_id", context.user.id).maybeSingle();
  const { error } = await context.supabase.from("bgm_library_items").delete().eq("id", id).eq("user_id", context.user.id);
  if (error) return databaseErrorResponse(error, "BGM을 보관함에서 제거하지 못했습니다.");
  if (item?.bgm_asset_id) {
    const admin = createSupabaseAdminClient();
    const [{ count: library }, { count: playlists }, { count: pages }, { data: asset }] = await Promise.all([
      admin.from("bgm_library_items").select("id", { count: "exact", head: true }).eq("bgm_asset_id", item.bgm_asset_id),
      admin.from("bgm_playlist_items").select("id", { count: "exact", head: true }).eq("bgm_asset_id", item.bgm_asset_id),
      admin.from("page_bgm_items").select("id", { count: "exact", head: true }).eq("bgm_asset_id", item.bgm_asset_id),
      admin.from("bgm_assets").select("owner_user_id").eq("id", item.bgm_asset_id).maybeSingle()
    ]);
    if (asset?.owner_user_id === context.user.id && (library ?? 0) + (playlists ?? 0) + (pages ?? 0) === 0) await admin.from("bgm_assets").update({ deleted_at: new Date().toISOString() }).eq("id", item.bgm_asset_id);
  }
  return NextResponse.json({ ok: true });
}
