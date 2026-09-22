import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { normalizeSpeakerKey } from "@/lib/speaker-avatars";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context?.canEdit) return NextResponse.json({ error: "Guest 편집 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string" || (body.variantId !== null && typeof body.variantId !== "string")) return NextResponse.json({ error: "표정 선택 정보가 올바르지 않습니다." }, { status: 400 });
  const { data: entry } = await context.admin.from("log_entries").select("id, speaker_name, log_id").eq("id", body.entryId).eq("log_id", context.log.id).eq("is_deleted", false).maybeSingle();
  if (!entry?.speaker_name) return NextResponse.json({ error: "화자가 있는 메시지가 아닙니다." }, { status: 400 });
  let writeError: { message?: string } | null = null;
  if (body.variantId === null) writeError = (await context.admin.from("log_entry_avatar_overrides").delete().eq("entry_id", body.entryId)).error;
  else {
    const { data: variant } = await context.admin.from("speaker_avatar_variants").select("id, is_default, profile_id").eq("id", body.variantId).maybeSingle();
    const { data: profile } = variant ? await context.admin.from("page_speaker_profiles").select("page_id, speaker_key").eq("id", variant.profile_id).maybeSingle() : { data: null };
    if (!variant || variant.is_default || !profile || profile.speaker_key !== normalizeSpeakerKey(entry.speaker_name)) return NextResponse.json({ error: "이 화자에게 적용할 수 없는 표정입니다." }, { status: 400 });
    if (profile.page_id !== context.page.id) return NextResponse.json({ error: "이 페이지의 표정이 아닙니다." }, { status: 400 });
    writeError = (await context.admin.from("log_entry_avatar_overrides").upsert({ entry_id: body.entryId, variant_id: body.variantId, updated_by: null, updated_at: new Date().toISOString() })).error;
  }
  if (writeError) return NextResponse.json({ error: "표정을 저장하지 못했습니다." }, { status: 500 });
  await context.admin.from("log_change_events").insert({ log_id: context.log.id, entry_id: body.entryId, event_type: "speaker_avatars_changed" });
  return NextResponse.json({ ok: true, entryId: body.entryId, variantId: body.variantId });
}
