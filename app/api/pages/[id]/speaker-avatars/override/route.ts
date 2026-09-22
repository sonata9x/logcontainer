import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeSpeakerKey } from "@/lib/speaker-avatars";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "페이지 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.entryId !== "string" || (body.variantId !== null && typeof body.variantId !== "string")) return NextResponse.json({ error: "표정 선택 정보가 올바르지 않습니다." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: entry } = await admin.from("log_entries").select("id, speaker_name, logs!inner(id, page_id)").eq("id", body.entryId).eq("logs.page_id", id).eq("is_deleted", false).maybeSingle();
  if (!entry?.speaker_name) return NextResponse.json({ error: "화자가 있는 메시지가 아닙니다." }, { status: 400 });
  let writeError: { message?: string } | null = null;
  if (body.variantId === null) writeError = (await admin.from("log_entry_avatar_overrides").delete().eq("entry_id", body.entryId)).error;
  else {
    const { data: variant } = await admin.from("speaker_avatar_variants").select("id, is_default, profile_id").eq("id", body.variantId).maybeSingle();
    const { data: profile } = variant ? await admin.from("page_speaker_profiles").select("page_id, speaker_key").eq("id", variant.profile_id).maybeSingle() : { data: null };
    if (!variant || variant.is_default || !profile || profile.speaker_key !== normalizeSpeakerKey(entry.speaker_name)) return NextResponse.json({ error: "이 화자에게 적용할 수 없는 표정입니다." }, { status: 400 });
    if (profile.page_id !== id) return NextResponse.json({ error: "이 페이지의 표정이 아닙니다." }, { status: 400 });
    writeError = (await admin.from("log_entry_avatar_overrides").upsert({ entry_id: body.entryId, variant_id: body.variantId, updated_by: context.user.id, updated_at: new Date().toISOString() })).error;
  }
  if (writeError) return NextResponse.json({ error: "표정을 저장하지 못했습니다." }, { status: 500 });
  const logRelation = Array.isArray(entry.logs) ? entry.logs[0] : entry.logs;
  await admin.from("log_change_events").insert({ log_id: logRelation!.id, entry_id: body.entryId, event_type: "speaker_avatars_changed" });
  return NextResponse.json({ ok: true, entryId: body.entryId, variantId: body.variantId });
}
