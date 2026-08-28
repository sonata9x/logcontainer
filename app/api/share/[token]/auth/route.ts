import { NextRequest, NextResponse } from "next/server";
import { getGuestLinkContext, GUEST_SESSION_COOKIE, GUEST_SESSION_SECONDS } from "@/lib/guest-auth";
import { createOpaqueToken, hashOpaqueToken, hashPassword, verifyPassword } from "@/lib/secure-credentials";
import { enforceRateLimit } from "@/lib/rate-limit";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await enforceRateLimit(request, { scope: "guest-page-auth", maxRequests: 10, windowSeconds: 600, blockSeconds: 900 });
  if (limited) return limited;
  const context = await getGuestLinkContext(token);
  if (!context) return NextResponse.json({ error: "Guest 링크가 유효하지 않습니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const body = await request.json().catch(() => ({}));
  const nickname = typeof body.nickname === "string" ? body.nickname.trim().toLocaleLowerCase("ko-KR") : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (nickname.length < 2 || nickname.length > 40 || /[\u0000-\u001f\u007f]/.test(nickname)) return NextResponse.json({ error: "닉네임은 2~40자로 입력해주세요." }, { status: 400 });
  if (password.length < 4 || password.length > 200) return NextResponse.json({ error: "비밀번호는 4~200자로 입력해주세요." }, { status: 400 });
  const { admin, link, page } = context;
  let { data: participant } = await admin.from("guest_participants")
    .select("id, page_id, nickname, password_hash, access_level")
    .eq("page_id", link.page_id).eq("nickname", nickname).is("revoked_at", null).maybeSingle();
  if (participant) {
    if (!await verifyPassword(password, participant.password_hash)) return NextResponse.json({ error: "닉네임 또는 비밀번호가 올바르지 않습니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  } else {
    if (body.passwordConfirm !== password) return NextResponse.json({ error: "비밀번호 확인이 일치하지 않습니다." }, { status: 400 });
    const passwordHash = await hashPassword(password);
    const result = await admin.from("guest_participants").insert({
      page_id: link.page_id, nickname, password_hash: passwordHash,
      access_level: link.default_access_level
    }).select("id, page_id, nickname, password_hash, access_level").single();
    if (result.error) return databaseErrorResponse(result.error, "Guest 참여자를 만들지 못했습니다.");
    participant = result.data;
  }
  const sessionToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + GUEST_SESSION_SECONDS * 1000).toISOString();
  const { error } = await admin.from("guest_sessions").insert({
    guest_participant_id: participant.id, token_hash: hashOpaqueToken(sessionToken), expires_at: expiresAt
  });
  if (error) return databaseErrorResponse(error, "Guest 세션을 만들지 못했습니다.");
  const response = NextResponse.json({ participant: { id: participant.id, nickname: participant.nickname, accessLevel: participant.access_level }, page: { id: page.id, title: page.title } });
  response.cookies.set(GUEST_SESSION_COOKIE, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: GUEST_SESSION_SECONDS });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function DELETE(request: NextRequest) {
  const sessionToken = request.cookies.get(GUEST_SESSION_COOKIE)?.value;
  const response = NextResponse.json({ signedOut: true });
  if (sessionToken) {
    const { createSupabaseAdminClient } = await import("@/lib/supabase/admin");
    await createSupabaseAdminClient().from("guest_sessions").update({ revoked_at: new Date().toISOString() }).eq("token_hash", hashOpaqueToken(sessionToken));
  }
  response.cookies.set(GUEST_SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
