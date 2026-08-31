import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { createPublicationToken } from "@/lib/publication-token";
import { hashPassword, verifyPassword } from "@/lib/secure-credentials";
import { databaseErrorResponse } from "@/lib/api-error";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canPublish || context.page.page_type !== "log") return NextResponse.json({ error: "게시 관리 권한이 없습니다." }, { status: 403 });
  const { data, error } = await context.supabase.rpc("get_publication_management", { target_page_id: id });
  return error ? databaseErrorResponse(error, "게시 설정을 불러오지 못했습니다.") : NextResponse.json(data ?? { isActive: false });
}

async function configure(request: Request, id: string) {
  const context = await getApiPageContext(id);
  if (!context?.canPublish || context.page.page_type !== "log") return NextResponse.json({ error: "게시 관리 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const visibility = body.visibility === "password" ? "password" : body.visibility === "public" ? "public" : null;
  if (!visibility) return NextResponse.json({ error: "공개 범위를 선택해주세요." }, { status: 400 });
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin.from("publications")
    .select("id, is_active, visibility, password_hash").eq("page_id", id).maybeSingle();
  if (existingError) return databaseErrorResponse(existingError, "현재 게시 설정을 확인하지 못했습니다.");
  const hasExistingPassword = existing?.visibility === "password" && typeof existing.password_hash === "string";
  if (hasExistingPassword) {
    const limited = await enforceRateLimit(request, { scope: "publication-management-password", identity: context.user.id, maxRequests: 8, windowSeconds: 600, blockSeconds: 900 });
    if (limited) return limited;
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    if (currentPassword.length < 4 || currentPassword.length > 200 || !await verifyPassword(currentPassword, existing.password_hash!)) {
      return NextResponse.json({ error: "현재 게시 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }
  }
  let passwordHash: string | null = null;
  if (visibility === "password") {
    const nextPassword = typeof body.newPassword === "string" ? body.newPassword : typeof body.password === "string" ? body.password : "";
    if (hasExistingPassword && !nextPassword) passwordHash = existing.password_hash!;
    else {
      if (nextPassword.length < 4 || nextPassword.length > 200) return NextResponse.json({ error: "비밀번호는 4~200자로 입력해주세요." }, { status: 400 });
      passwordHash = await hashPassword(nextPassword);
    }
  }
  const { data, error } = await context.supabase.rpc("configure_publication", {
    target_page_id: id, next_token: createPublicationToken(),
    next_visibility: visibility, next_password_hash: passwordHash
  });
  return error ? databaseErrorResponse(error, "게시 설정을 저장하지 못했습니다.") : NextResponse.json(data, { status: 201 });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return configure(request, (await params).id);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return configure(request, (await params).id);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canPublish || context.page.page_type !== "log") return NextResponse.json({ error: "게시 관리 권한이 없습니다." }, { status: 403 });
  const { data, error } = await context.supabase.rpc("stop_publication", { target_page_id: id });
  return error ? databaseErrorResponse(error, "게시를 중단하지 못했습니다.") : NextResponse.json(data ?? { is_active: false });
}
