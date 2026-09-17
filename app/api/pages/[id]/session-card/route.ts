import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { SESSION_CARD_BUCKET, sessionCardExtension, validSessionCard } from "@/lib/page-extras";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const SELECT = "session_card_path, session_card_mime, session_card_size";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "페이지 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!validSessionCard(body.mimeType, body.byteSize)) return NextResponse.json({ error: "10MB 이하 PNG, JPG, GIF, WebP 이미지만 사용할 수 있습니다." }, { status: 400 });
  const path = `${id}/${randomUUID()}.${sessionCardExtension(body.mimeType)}`;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.storage.from(SESSION_CARD_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return NextResponse.json({ error: "업로드 주소를 만들지 못했습니다." }, { status: 500 });
  return NextResponse.json({ path, token: data.token, signedUrl: data.signedUrl, mimeType: body.mimeType, byteSize: body.byteSize });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "페이지 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.path !== "string" || !body.path.startsWith(`${id}/`) || !validSessionCard(body.mimeType, body.byteSize)) return NextResponse.json({ error: "업로드 정보가 올바르지 않습니다." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: files, error: listError } = await admin.storage.from(SESSION_CARD_BUCKET).list(id, { search: body.path.slice(id.length + 1), limit: 2 });
  if (listError || !files?.some((file) => `${id}/${file.name}` === body.path)) return NextResponse.json({ error: "업로드된 이미지를 찾지 못했습니다." }, { status: 400 });
  const { data: previous } = await context.supabase.from("pages").select(SELECT).eq("id", id).single();
  const { error } = await context.supabase.rpc("update_page_extras", { target_page_id: id, changes: { session_card_path: body.path, session_card_mime: body.mimeType, session_card_size: body.byteSize } });
  if (error) {
    await admin.storage.from(SESSION_CARD_BUCKET).remove([body.path]);
    return databaseErrorResponse(error, "세션 카드를 저장하지 못했습니다.");
  }
  if (previous?.session_card_path && previous.session_card_path !== body.path) await admin.storage.from(SESSION_CARD_BUCKET).remove([previous.session_card_path]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "페이지 수정 권한이 없습니다." }, { status: 403 });
  const { data: previous } = await context.supabase.from("pages").select(SELECT).eq("id", id).single();
  const { error } = await context.supabase.rpc("update_page_extras", { target_page_id: id, changes: { session_card_path: null, session_card_mime: null, session_card_size: null } });
  if (error) return databaseErrorResponse(error, "세션 카드를 삭제하지 못했습니다.");
  if (previous?.session_card_path) await createSupabaseAdminClient().storage.from(SESSION_CARD_BUCKET).remove([previous.session_card_path]);
  return NextResponse.json({ ok: true });
}
