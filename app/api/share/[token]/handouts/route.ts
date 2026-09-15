import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { serializeHandouts } from "@/lib/handouts";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.admin.from("handouts").select("id, page_id, title, content, order_index, created_at, updated_at").eq("page_id", context.page.id).order("order_index").order("created_at");
  if (error) return NextResponse.json({ error: "핸드아웃을 불러오지 못했습니다." }, { status: 500 });
  return NextResponse.json({ handouts: await serializeHandouts(context.admin, data ?? []) }, { headers: { "Cache-Control": "private, no-store" } });
}
