import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serializeHandouts } from "@/lib/handouts";
import { getPublicationAccess, PUBLICATION_SESSION_COOKIE } from "@/lib/publication-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cookieStore = await cookies();
  const access = await getPublicationAccess(token, cookieStore.get(PUBLICATION_SESSION_COOKIE)?.value);
  if (!access?.authorized) return NextResponse.json({ error: "게시된 로그를 찾지 못했습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const { data, error } = await access.admin.from("handouts").select("id, page_id, title, content, order_index, created_at, updated_at").eq("page_id", access.page.id).order("order_index").order("created_at");
  if (error) return NextResponse.json({ error: "핸드아웃을 불러오지 못했습니다." }, { status: 500 });
  try {
    return NextResponse.json({ handouts: await serializeHandouts(access.admin, data ?? []) });
  } catch {
    return NextResponse.json({ error: "핸드아웃 이미지를 불러오지 못했습니다." }, { status: 500 });
  }
}
