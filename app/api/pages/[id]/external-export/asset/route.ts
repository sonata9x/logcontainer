import { NextRequest, NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { BGM_AUDIO_BUCKET } from "@/lib/bgm";
import { HANDOUT_IMAGE_BUCKET } from "@/lib/handouts";
import { SESSION_CARD_BUCKET } from "@/lib/page-extras";
import { SPEAKER_AVATAR_BUCKET } from "@/lib/speaker-avatars";

type AssetTarget = { bucket: string; path: string; mimeType: string | null };

async function resolveTarget(pageId: string, kind: string, assetId: string): Promise<AssetTarget | null> {
  const admin = createSupabaseAdminClient();
  if (kind === "bgm") {
    const { data: usage } = await admin.from("page_bgm_items").select("id").eq("page_id", pageId).eq("bgm_asset_id", assetId).limit(1).maybeSingle();
    if (!usage) return null;
    const { data: asset } = await admin.from("bgm_assets").select("storage_path, mime_type, source_type, is_ready, deleted_at").eq("id", assetId).maybeSingle();
    return asset?.source_type === "upload" && asset.is_ready && !asset.deleted_at && asset.storage_path
      ? { bucket: BGM_AUDIO_BUCKET, path: asset.storage_path, mimeType: asset.mime_type ?? "audio/mpeg" } : null;
  }
  if (kind === "session-card") {
    const { data: page } = await admin.from("pages").select("session_card_path, session_card_mime").eq("id", pageId).maybeSingle();
    return page?.session_card_path ? { bucket: SESSION_CARD_BUCKET, path: page.session_card_path, mimeType: page.session_card_mime } : null;
  }
  if (kind === "handout") {
    const { data: image } = await admin.from("handout_images").select("handout_id, storage_path, mime_type, is_ready").eq("id", assetId).maybeSingle();
    if (!image?.is_ready) return null;
    const { data: handout } = await admin.from("handouts").select("id").eq("id", image.handout_id).eq("page_id", pageId).maybeSingle();
    return handout ? { bucket: HANDOUT_IMAGE_BUCKET, path: image.storage_path, mimeType: image.mime_type } : null;
  }
  if (kind === "avatar") {
    const { data: variant } = await admin.from("speaker_avatar_variants").select("profile_id, storage_path").eq("id", assetId).maybeSingle();
    if (!variant) return null;
    const { data: profile } = await admin.from("page_speaker_profiles").select("id").eq("id", variant.profile_id).eq("page_id", pageId).maybeSingle();
    return profile ? { bucket: SPEAKER_AVATAR_BUCKET, path: variant.storage_path, mimeType: null } : null;
  }
  return null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log" || !context.canReimport) return new Response("Not found", { status: 404 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "";
  const assetId = url.searchParams.get("assetId") ?? "";
  const target = await resolveTarget(id, kind, assetId);
  if (!target) return new Response("Not found", { status: 404 });
  const { data, error } = await createSupabaseAdminClient().storage.from(target.bucket).download(target.path);
  if (error || !data) return NextResponse.json({ error: "내보낼 파일을 불러오지 못했습니다." }, { status: 502 });
  return new Response(data, { headers: {
    "Content-Type": target.mimeType || data.type || "application/octet-stream",
    "Content-Length": String(data.size),
    "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(target.path.split("/").at(-1) ?? "asset")}`
  } });
}
