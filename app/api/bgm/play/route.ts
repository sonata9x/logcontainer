import { NextRequest, NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { BGM_AUDIO_BUCKET } from "@/lib/bgm";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { getPublicationAccess, PUBLICATION_SESSION_COOKIE } from "@/lib/publication-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const assetId = url.searchParams.get("assetId") ?? "";
  const pageId = url.searchParams.get("pageId") ?? "";
  const publicationToken = url.searchParams.get("publicationToken");
  const guestToken = url.searchParams.get("guestToken");
  if (!assetId || !pageId) return NextResponse.json({ error: "재생할 BGM 정보가 없습니다." }, { status: 400 });

  let authorized = false;
  if (publicationToken) {
    const context = await getPublicationAccess(publicationToken, request.cookies.get(PUBLICATION_SESSION_COOKIE)?.value);
    authorized = Boolean(context?.authorized && context.page.id === pageId);
  } else if (guestToken) {
    const context = await getGuestApiContext(guestToken, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
    authorized = Boolean(context && context.page.id === pageId);
  } else {
    const context = await getApiPageContext(pageId);
    authorized = Boolean(context);
  }
  if (!authorized) return NextResponse.json({ error: "BGM 재생 권한이 없습니다." }, { status: 403 });

  const admin = createSupabaseAdminClient();
  const { data: usage } = await admin.from("page_bgm_items").select("id").eq("page_id", pageId).eq("bgm_asset_id", assetId).limit(1).maybeSingle();
  if (!usage) return NextResponse.json({ error: "이 페이지에서 사용하는 BGM이 아닙니다." }, { status: 404 });
  const { data: asset } = await admin.from("bgm_assets").select("source_type, storage_path, youtube_video_id").eq("id", assetId).eq("is_ready", true).is("deleted_at", null).maybeSingle();
  if (!asset) return NextResponse.json({ error: "BGM을 찾지 못했습니다." }, { status: 404 });
  if (asset.source_type === "youtube") return NextResponse.json({ sourceType: "youtube", videoId: asset.youtube_video_id }, { headers: { "Cache-Control": "private, no-store" } });
  const { data } = await admin.storage.from(BGM_AUDIO_BUCKET).createSignedUrl(asset.storage_path, 60 * 30);
  if (!data?.signedUrl) return NextResponse.json({ error: "BGM 재생 주소를 만들지 못했습니다." }, { status: 500 });
  return NextResponse.json({ sourceType: "upload", url: data.signedUrl }, { headers: { "Cache-Control": "private, no-store" } });
}
