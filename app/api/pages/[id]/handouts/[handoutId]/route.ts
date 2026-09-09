import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { HANDOUT_IMAGE_BUCKET } from "@/lib/handouts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function editContext(pageId: string, handoutId: string) {
  const context = await getApiPageContext(pageId);
  if (!context?.canEdit || context.page.page_type !== "log") return null;
  const { data } = await context.supabase.from("handouts").select("id, page_id").eq("id", handoutId).eq("page_id", pageId).maybeSingle();
  return data ? context : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; handoutId: string }> }) {
  const { id, handoutId } = await params;
  const context = await editContext(id, handoutId);
  if (!context) return NextResponse.json({ error: "핸드아웃 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  const content = typeof body.content === "string" ? body.content.slice(0, 200_000) : "";
  if (!title) return NextResponse.json({ error: "핸드아웃 제목을 입력해주세요." }, { status: 400 });
  const { data, error } = await context.supabase.from("handouts").update({ title, content, updated_at: new Date().toISOString() }).eq("id", handoutId).eq("page_id", id).select("id, page_id, title, content, order_index, created_at, updated_at").single();
  return error ? databaseErrorResponse(error, "핸드아웃을 수정하지 못했습니다.") : NextResponse.json({ handout: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; handoutId: string }> }) {
  const { id, handoutId } = await params;
  const context = await editContext(id, handoutId);
  if (!context) return NextResponse.json({ error: "핸드아웃 삭제 권한이 없습니다." }, { status: 403 });
  const admin = createSupabaseAdminClient();
  const { data: images } = await admin.from("handout_images").select("storage_path").eq("handout_id", handoutId);
  const paths = (images ?? []).map((image) => image.storage_path);
  if (paths.length) {
    const { error: storageError } = await admin.storage.from(HANDOUT_IMAGE_BUCKET).remove(paths);
    if (storageError) return NextResponse.json({ error: "핸드아웃 이미지를 삭제하지 못했습니다." }, { status: 500 });
  }
  const { error } = await context.supabase.from("handouts").delete().eq("id", handoutId).eq("page_id", id);
  if (error) return databaseErrorResponse(error, "핸드아웃을 삭제하지 못했습니다.");
  return NextResponse.json({ deleted: true });
}
