import { NextRequest, NextResponse } from "next/server";
import { getGuestApiContext, GUEST_SESSION_COOKIE } from "@/lib/guest-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const context = await getGuestApiContext(token, request.cookies.get(GUEST_SESSION_COOKIE)?.value);
  if (!context) return NextResponse.json({ error: "Guest 로그인이 필요합니다." }, { status: 401 });
  if (!context.canEdit) return NextResponse.json({ error: "Guest 뷰어는 제목을 수정할 수 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
  if (!title) return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
  const { data, error } = await context.admin.rpc("update_guest_page_title", {
    target_guest_participant_id: context.participant.id, target_page_id: context.page.id, next_title: title
  });
  return error ? databaseErrorResponse(error, "Guest 로그 제목을 바꾸지 못했습니다.") : NextResponse.json({ title: data });
}
