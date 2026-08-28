import { NextRequest, NextResponse } from "next/server";
import { getPublicationContext, PUBLICATION_SESSION_COOKIE, PUBLICATION_SESSION_SECONDS } from "@/lib/publication-auth";
import { createOpaqueToken, hashOpaqueToken, verifyPassword } from "@/lib/secure-credentials";
import { enforceRateLimit } from "@/lib/rate-limit";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const limited = await enforceRateLimit(request, { scope: "publication-password", maxRequests: 8, windowSeconds: 600, blockSeconds: 900 });
  if (limited) return limited;
  const context = await getPublicationContext(token);
  if (!context || context.publication.visibility !== "password" || !context.publication.password_hash) return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (!await verifyPassword(password, context.publication.password_hash)) return NextResponse.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const sessionToken = createOpaqueToken();
  const { error } = await context.admin.from("publication_sessions").insert({
    publication_id: context.publication.id, token_hash: hashOpaqueToken(sessionToken),
    password_version: context.publication.password_version,
    expires_at: new Date(Date.now() + PUBLICATION_SESSION_SECONDS * 1000).toISOString()
  });
  if (error) return databaseErrorResponse(error, "게시물 세션을 만들지 못했습니다.");
  const response = NextResponse.json({ authorized: true });
  response.cookies.set(PUBLICATION_SESSION_COOKIE, sessionToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: PUBLICATION_SESSION_SECONDS });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
