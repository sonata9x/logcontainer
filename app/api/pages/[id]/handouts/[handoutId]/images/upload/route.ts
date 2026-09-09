import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { HANDOUT_IMAGE_BUCKET, handoutImageExtension, validHandoutImage } from "@/lib/handouts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; handoutId: string }> }) {
  const { id, handoutId } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit || context.page.page_type !== "log") return NextResponse.json({ error: "핸드아웃 수정 권한이 없습니다." }, { status: 403 });
  const { data: handout } = await context.supabase.from("handouts").select("id").eq("id", handoutId).eq("page_id", id).maybeSingle();
  if (!handout) return NextResponse.json({ error: "핸드아웃을 찾지 못했습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const byteSize = typeof body.byteSize === "number" ? body.byteSize : 0;
  const originalName = typeof body.originalName === "string" ? body.originalName.trim().slice(0, 255) : "image";
  if (!validHandoutImage(mimeType, byteSize)) return NextResponse.json({ error: "PNG, JPEG, GIF, WebP 이미지만 10MB까지 업로드할 수 있습니다." }, { status: 400 });
  const imageId = randomUUID();
  const storagePath = `${id}/${handoutId}/${imageId}.${handoutImageExtension(mimeType)}`;
  const admin = createSupabaseAdminClient();
  const { count } = await admin.from("handout_images").select("id", { count: "exact", head: true }).eq("handout_id", handoutId);
  if ((count ?? 0) >= 50) return NextResponse.json({ error: "한 핸드아웃에는 이미지를 최대 50개까지 넣을 수 있습니다." }, { status: 400 });
  const { data: last } = await admin.from("handout_images").select("order_index").eq("handout_id", handoutId).order("order_index", { ascending: false }).limit(1).maybeSingle();
  const { error: insertError } = await admin.from("handout_images").insert({ id: imageId, handout_id: handoutId, storage_path: storagePath, original_name: originalName || "image", mime_type: mimeType, byte_size: byteSize, order_index: (last?.order_index ?? -1) + 1, created_by: context.user.id });
  if (insertError) return databaseErrorResponse(insertError, "이미지 업로드를 준비하지 못했습니다.");
  const { data, error } = await admin.storage.from(HANDOUT_IMAGE_BUCKET).createSignedUploadUrl(storagePath);
  if (error || !data) {
    await admin.from("handout_images").delete().eq("id", imageId);
    return NextResponse.json({ error: "이미지 업로드 주소를 만들지 못했습니다." }, { status: 500 });
  }
  return NextResponse.json({ imageId, path: data.path, token: data.token }, { status: 201 });
}
