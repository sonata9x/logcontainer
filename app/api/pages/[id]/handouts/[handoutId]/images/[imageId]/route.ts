import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { HANDOUT_IMAGE_BUCKET } from "@/lib/handouts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function imageContext(pageId: string, handoutId: string, imageId: string) {
  const context = await getApiPageContext(pageId);
  if (!context?.canEdit || context.page.page_type !== "log") return null;
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from("handout_images").select("id, storage_path, handouts!inner(page_id)").eq("id", imageId).eq("handout_id", handoutId).eq("handouts.page_id", pageId).maybeSingle();
  return data ? { context, admin, image: data } : null;
}

export async function PATCH(_request: Request, { params }: { params: Promise<{ id: string; handoutId: string; imageId: string }> }) {
  const { id, handoutId, imageId } = await params;
  const resolved = await imageContext(id, handoutId, imageId);
  if (!resolved) return NextResponse.json({ error: "이미지를 찾지 못했거나 수정 권한이 없습니다." }, { status: 404 });
  const pathParts = resolved.image.storage_path.split("/");
  const fileName = pathParts.pop() ?? "";
  const { data: objects, error: storageError } = await resolved.admin.storage.from(HANDOUT_IMAGE_BUCKET).list(pathParts.join("/"), { search: fileName, limit: 2 });
  if (storageError || !objects?.some((object) => object.name === fileName)) return NextResponse.json({ error: "업로드된 이미지를 확인하지 못했습니다." }, { status: 409 });
  const { error } = await resolved.admin.from("handout_images").update({ is_ready: true }).eq("id", imageId);
  return error ? NextResponse.json({ error: "이미지를 확정하지 못했습니다." }, { status: 500 }) : NextResponse.json({ ready: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; handoutId: string; imageId: string }> }) {
  const { id, handoutId, imageId } = await params;
  const resolved = await imageContext(id, handoutId, imageId);
  if (!resolved) return NextResponse.json({ error: "이미지를 찾지 못했거나 수정 권한이 없습니다." }, { status: 404 });
  const { error: storageError } = await resolved.admin.storage.from(HANDOUT_IMAGE_BUCKET).remove([resolved.image.storage_path]);
  if (storageError) return NextResponse.json({ error: "이미지 파일을 삭제하지 못했습니다." }, { status: 500 });
  const { error } = await resolved.admin.from("handout_images").delete().eq("id", imageId);
  if (error) return NextResponse.json({ error: "이미지 정보를 삭제하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
