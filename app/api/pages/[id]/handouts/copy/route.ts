import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { HANDOUT_IMAGE_BUCKET, handoutImageExtension } from "@/lib/handouts";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const HANDOUT_SELECT = "id, page_id, title, content, order_index, created_at";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit) return NextResponse.json({ error: "핸드아웃 수정 권한이 없습니다." }, { status: 403 });
  const { data: handouts, error } = await context.supabase.from("handouts").select(HANDOUT_SELECT).neq("page_id", id).order("created_at", { ascending: false }).limit(1000);
  if (error) return databaseErrorResponse(error, "가져올 핸드아웃을 불러오지 못했습니다.");
  const pageIds = [...new Set((handouts ?? []).map((item) => item.page_id))];
  const { data: pages } = pageIds.length ? await context.supabase.from("pages").select("id, title").in("id", pageIds).eq("page_type", "log") : { data: [] };
  const titles = new Map((pages ?? []).map((page) => [page.id, page.title]));
  return NextResponse.json({ sources: pageIds.filter((pageId) => titles.has(pageId)).map((pageId) => ({ pageId, pageTitle: titles.get(pageId), handouts: (handouts ?? []).filter((item) => item.page_id === pageId).map(({ id: handoutId, title }) => ({ id: handoutId, title })) })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canEdit) return NextResponse.json({ error: "핸드아웃 수정 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const requestedIds = Array.isArray(body.handoutIds) ? [...new Set(body.handoutIds.filter((value: unknown): value is string => typeof value === "string"))].slice(0, 100) : [];
  if (!requestedIds.length) return NextResponse.json({ error: "가져올 핸드아웃을 선택해주세요." }, { status: 400 });
  const { data: sources, error } = await context.supabase.from("handouts").select(HANDOUT_SELECT).in("id", requestedIds);
  if (error) return databaseErrorResponse(error, "원본 핸드아웃을 불러오지 못했습니다.");
  if ((sources ?? []).length !== requestedIds.length) return NextResponse.json({ error: "열람할 수 없는 핸드아웃이 포함되어 있습니다." }, { status: 403 });
  const { data: images, error: imageError } = await context.supabase.from("handout_images").select("id, handout_id, storage_path, original_name, mime_type, byte_size, order_index").in("handout_id", requestedIds).eq("is_ready", true);
  if (imageError) return databaseErrorResponse(imageError, "원본 핸드아웃 이미지를 불러오지 못했습니다.");
  const { data: last } = await context.supabase.from("handouts").select("order_index").eq("page_id", id).order("order_index", { ascending: false }).limit(1).maybeSingle();
  const admin = createSupabaseAdminClient();
  const createdIds: string[] = [];
  const copiedPaths: string[] = [];
  try {
    for (const [index, source] of (sources ?? []).entries()) {
      const { data: created, error: createError } = await context.supabase.from("handouts").insert({ page_id: id, title: source.title, content: source.content, order_index: (last?.order_index ?? -1) + index + 1, created_by: context.user.id }).select("id").single();
      if (createError || !created) throw new Error("copy row failed");
      createdIds.push(created.id);
      for (const image of (images ?? []).filter((item) => item.handout_id === source.id)) {
        const path = `${id}/${created.id}/${randomUUID()}.${handoutImageExtension(image.mime_type)}`;
        const { error: copyError } = await admin.storage.from(HANDOUT_IMAGE_BUCKET).copy(image.storage_path, path);
        if (copyError) throw new Error("copy object failed");
        copiedPaths.push(path);
        const { error: rowError } = await context.supabase.from("handout_images").insert({ handout_id: created.id, storage_path: path, original_name: image.original_name, mime_type: image.mime_type, byte_size: image.byte_size, order_index: image.order_index, is_ready: true, created_by: context.user.id });
        if (rowError) throw new Error("copy image row failed");
      }
    }
  } catch {
    if (copiedPaths.length) await admin.storage.from(HANDOUT_IMAGE_BUCKET).remove(copiedPaths);
    if (createdIds.length) await admin.from("handouts").delete().in("id", createdIds);
    return NextResponse.json({ error: "핸드아웃을 복사하지 못했습니다. 만들어진 복사본은 정리했습니다." }, { status: 500 });
  }
  return NextResponse.json({ copied: createdIds.length }, { status: 201 });
}
