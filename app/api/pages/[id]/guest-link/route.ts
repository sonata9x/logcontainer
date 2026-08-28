import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/secure-credentials";

function guestRole(value: unknown): value is "viewer" | "editor" {
  return value === "viewer" || value === "editor";
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManageGuestLink || context.page.page_type !== "log") return NextResponse.json({ error: "Guest 링크 관리 권한이 없습니다." }, { status: 403 });
  const { data, error } = await context.supabase.rpc("get_page_share_link_management", { target_page_id: id });
  return error ? databaseErrorResponse(error, "Guest 공유 정보를 불러오지 못했습니다.") : NextResponse.json(data ?? { link: null, participants: [] });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManageGuestLink || context.page.page_type !== "log") return NextResponse.json({ error: "Guest 링크 관리 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const accessLevel = guestRole(body.defaultAccessLevel) ? body.defaultAccessLevel : "viewer";
  const token = createOpaqueToken();
  const { data, error } = await context.supabase.rpc("configure_page_share_link", {
    target_page_id: id, next_token_hash: hashOpaqueToken(token), next_is_active: true,
    next_default_access_level: accessLevel
  });
  return error ? databaseErrorResponse(error, "Guest 링크를 만들지 못했습니다.") : NextResponse.json({ link: data, token, url: `/share/${token}` }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManageGuestLink || context.page.page_type !== "log") return NextResponse.json({ error: "Guest 링크 관리 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.participantId === "string") {
    if (!guestRole(body.accessLevel)) return NextResponse.json({ error: "올바른 Guest 권한을 선택해주세요." }, { status: 400 });
    const { data, error } = await context.supabase.rpc("manage_guest_participant", {
      target_page_id: id, target_guest_participant_id: body.participantId,
      next_access_level: body.accessLevel, should_revoke: false
    });
    return error ? databaseErrorResponse(error, "Guest 권한을 바꾸지 못했습니다.") : NextResponse.json({ updated: data });
  }
  if (!guestRole(body.defaultAccessLevel)) return NextResponse.json({ error: "올바른 기본 권한을 선택해주세요." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("configure_page_share_link", {
    target_page_id: id, next_token_hash: null, next_is_active: null,
    next_default_access_level: body.defaultAccessLevel
  });
  return error ? databaseErrorResponse(error, "Guest 기본 권한을 바꾸지 못했습니다.") : NextResponse.json({ link: data });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManageGuestLink || context.page.page_type !== "log") return NextResponse.json({ error: "Guest 링크 관리 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.participantId === "string") {
    const { data, error } = await context.supabase.rpc("manage_guest_participant", {
      target_page_id: id, target_guest_participant_id: body.participantId,
      next_access_level: null, should_revoke: true
    });
    return error ? databaseErrorResponse(error, "Guest를 제거하지 못했습니다.") : NextResponse.json({ revoked: data });
  }
  const { data, error } = await context.supabase.rpc("configure_page_share_link", {
    target_page_id: id, next_token_hash: null, next_is_active: false,
    next_default_access_level: null
  });
  return error ? databaseErrorResponse(error, "Guest 링크를 중지하지 못했습니다.") : NextResponse.json({ link: data });
}
