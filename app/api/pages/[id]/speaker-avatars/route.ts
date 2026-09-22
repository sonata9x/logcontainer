import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSpeakerAvatarBundle, normalizeSpeakerKey, normalizeVariantKey, SPEAKER_AVATAR_BUCKET, SPEAKER_AVATAR_PLATFORMS, speakerAvatarExtension, validSpeakerAvatar } from "@/lib/speaker-avatars";

async function pageLog(admin: ReturnType<typeof createSupabaseAdminClient>, pageId: string) {
  return (await admin.from("logs").select("id, platform").eq("page_id", pageId).maybeSingle()).data;
}

async function speakerExists(admin: ReturnType<typeof createSupabaseAdminClient>, pageId: string, speakerName: string) {
  const { data } = await admin.rpc("list_page_log_speakers", { target_page_id: pageId });
  const key = normalizeSpeakerKey(speakerName);
  return (data ?? []).some((item: { speaker_name: string }) => normalizeSpeakerKey(item.speaker_name) === key);
}

async function emitChange(admin: ReturnType<typeof createSupabaseAdminClient>, logId: string, entryId: string | null = null) {
  await admin.from("log_change_events").insert({ log_id: logId, entry_id: entryId, event_type: "speaker_avatars_changed" });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.page.page_type !== "log") return NextResponse.json({ error: "로그를 찾지 못했습니다." }, { status: 404 });
  return NextResponse.json({ avatars: await getSpeakerAvatarBundle(createSupabaseAdminClient(), id) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "페이지 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const speakerName = typeof body.speakerName === "string" ? body.speakerName.trim().slice(0, 200) : "";
  if (!speakerName || !validSpeakerAvatar(body.mimeType, body.byteSize)) return NextResponse.json({ error: "아바타 업로드 정보가 올바르지 않습니다." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const log = await pageLog(admin, id);
  if (!log || !SPEAKER_AVATAR_PLATFORMS.has(log.platform)) return NextResponse.json({ error: "이 로그 형식에서는 화자 아바타를 지원하지 않습니다." }, { status: 400 });
  if (!await speakerExists(admin, id, speakerName)) return NextResponse.json({ error: "로그에서 해당 화자를 찾지 못했습니다." }, { status: 400 });
  const path = `${id}/${randomUUID()}.${speakerAvatarExtension(body.mimeType)}`;
  const { data, error } = await admin.storage.from(SPEAKER_AVATAR_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "업로드 주소를 만들지 못했습니다." }, { status: 500 });
  return NextResponse.json({ path, token: data.token, mimeType: body.mimeType, byteSize: body.byteSize });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "페이지 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const speakerName = typeof body.speakerName === "string" ? body.speakerName.trim().slice(0, 200) : "";
  const isDefault = body.isDefault === true;
  const variantName = isDefault ? "기본" : typeof body.variantName === "string" ? body.variantName.trim().slice(0, 80) : "";
  if (!speakerName || !variantName || typeof body.path !== "string" || !body.path.startsWith(`${id}/`) || !validSpeakerAvatar(body.mimeType, body.byteSize)) return NextResponse.json({ error: "아바타 저장 정보가 올바르지 않습니다." }, { status: 400 });
  if (!isDefault && normalizeVariantKey(variantName) === "__default__") return NextResponse.json({ error: "사용할 수 없는 표정 이름입니다." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const log = await pageLog(admin, id);
  if (!log || !SPEAKER_AVATAR_PLATFORMS.has(log.platform) || !await speakerExists(admin, id, speakerName)) return NextResponse.json({ error: "이 로그의 화자에게 적용할 수 없습니다." }, { status: 400 });
  const fileName = body.path.slice(id.length + 1);
  const { data: files } = await admin.storage.from(SPEAKER_AVATAR_BUCKET).list(id, { search: fileName, limit: 2 });
  if (!files?.some((file) => file.name === fileName)) return NextResponse.json({ error: "업로드된 이미지를 찾지 못했습니다." }, { status: 400 });
  const speakerKey = normalizeSpeakerKey(speakerName);
  const { data: profile, error: profileError } = await admin.from("page_speaker_profiles").upsert({ page_id: id, speaker_key: speakerKey, speaker_name: speakerName, created_by: context.user.id, updated_at: new Date().toISOString() }, { onConflict: "page_id,speaker_key" }).select("id").single();
  if (profileError || !profile) { await admin.storage.from(SPEAKER_AVATAR_BUCKET).remove([body.path]); return NextResponse.json({ error: "화자 정보를 저장하지 못했습니다." }, { status: 500 }); }
  const nameKey = isDefault ? "__default__" : normalizeVariantKey(variantName);
  const { data: previous } = await admin.from("speaker_avatar_variants").select("id, storage_path").eq("profile_id", profile.id).eq("name_key", nameKey).maybeSingle();
  const values = { profile_id: profile.id, name: variantName, name_key: nameKey, is_default: isDefault, storage_path: body.path, original_filename: typeof body.originalFilename === "string" ? body.originalFilename.slice(0, 255) : null, mime_type: body.mimeType, byte_size: body.byteSize, created_by: context.user.id, updated_at: new Date().toISOString() };
  const result = previous ? await admin.from("speaker_avatar_variants").update(values).eq("id", previous.id).select("id").single() : await admin.from("speaker_avatar_variants").insert(values).select("id").single();
  if (result.error) { await admin.storage.from(SPEAKER_AVATAR_BUCKET).remove([body.path]); return NextResponse.json({ error: "아바타를 저장하지 못했습니다." }, { status: 500 }); }
  if (previous?.storage_path && previous.storage_path !== body.path) await admin.storage.from(SPEAKER_AVATAR_BUCKET).remove([previous.storage_path]);
  await emitChange(admin, log.id);
  return NextResponse.json({ avatars: await getSpeakerAvatarBundle(admin, id) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "페이지 수정 권한이 없습니다." }, { status: 403 });
  const variantId = new URL(request.url).searchParams.get("variantId");
  if (!variantId) return NextResponse.json({ error: "삭제할 아바타가 없습니다." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: variant } = await admin.from("speaker_avatar_variants").select("id, storage_path, profile_id").eq("id", variantId).maybeSingle();
  const { data: profile } = variant ? await admin.from("page_speaker_profiles").select("page_id").eq("id", variant.profile_id).maybeSingle() : { data: null };
  if (!variant || profile?.page_id !== id) return NextResponse.json({ error: "아바타를 찾지 못했습니다." }, { status: 404 });
  const log = await pageLog(admin, id);
  const { error } = await admin.from("speaker_avatar_variants").delete().eq("id", variantId);
  if (error) return NextResponse.json({ error: "아바타를 삭제하지 못했습니다." }, { status: 500 });
  await admin.storage.from(SPEAKER_AVATAR_BUCKET).remove([variant.storage_path]);
  if (log) await emitChange(admin, log.id);
  return NextResponse.json({ avatars: await getSpeakerAvatarBundle(admin, id) });
}
