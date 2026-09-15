import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getApprovedApiContext } from "@/lib/api-auth";
import { BGM_AUDIO_BUCKET, validBgmUpload } from "@/lib/bgm";
import { databaseErrorResponse } from "@/lib/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title || !validBgmUpload(body.mimeType, body.byteSize)) return NextResponse.json({ error: "25MB 이하 MP3 파일과 제목을 확인해주세요." }, { status: 400 });
  const path = `${context.user.id}/${randomUUID()}.mp3`;
  const { data: asset, error } = await context.supabase.from("bgm_assets").insert({ owner_user_id: context.user.id, source_type: "upload", storage_path: path, canonical_title: title, mime_type: "audio/mpeg", byte_size: body.byteSize, is_ready: false }).select("id").single();
  if (error) return databaseErrorResponse(error, "BGM 업로드를 준비하지 못했습니다.");
  const admin = createSupabaseAdminClient();
  const { data, error: uploadError } = await admin.storage.from(BGM_AUDIO_BUCKET).createSignedUploadUrl(path);
  if (uploadError || !data) {
    await admin.from("bgm_assets").delete().eq("id", asset.id).eq("is_ready", false);
    return NextResponse.json({ error: "업로드 주소를 만들지 못했습니다." }, { status: 500 });
  }
  return NextResponse.json({ assetId: asset.id, path, token: data.token, signedUrl: data.signedUrl });
}

export async function PATCH(request: Request) {
  const context = await getApprovedApiContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const assetId = typeof body.assetId === "string" ? body.assetId : "";
  const { data: asset } = await context.supabase.from("bgm_assets").select("id, storage_path").eq("id", assetId).eq("owner_user_id", context.user.id).eq("is_ready", false).maybeSingle();
  if (!asset?.storage_path) return NextResponse.json({ error: "업로드 정보를 찾지 못했습니다." }, { status: 404 });
  const admin = createSupabaseAdminClient();
  const folder = asset.storage_path.split("/")[0];
  const filename = asset.storage_path.split("/").at(-1) ?? "";
  const { data: files } = await admin.storage.from(BGM_AUDIO_BUCKET).list(folder, { search: filename, limit: 2 });
  if (!files?.some((file) => file.name === filename)) return NextResponse.json({ error: "업로드된 파일을 찾지 못했습니다." }, { status: 400 });
  const { error } = await context.supabase.from("bgm_assets").update({ is_ready: true }).eq("id", assetId).eq("owner_user_id", context.user.id);
  if (error) return databaseErrorResponse(error, "BGM 업로드를 확정하지 못했습니다.");
  const { error: libraryError } = await context.supabase.from("bgm_library_items").insert({ user_id: context.user.id, bgm_asset_id: assetId });
  return libraryError ? databaseErrorResponse(libraryError, "BGM을 보관함에 넣지 못했습니다.") : NextResponse.json({ ok: true });
}
