import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { isValidUsername, normalizeUsername } from "@/lib/auth-identity";
import { databaseErrorResponse } from "@/lib/api-error";

const shareRoles = ["viewer", "editor", "admin"] as const;
function isShareRole(value: unknown): value is (typeof shareRoles)[number] {
  return typeof value === "string" && shareRoles.includes(value as (typeof shareRoles)[number]);
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManageShares) return NextResponse.json({ error: "공유 권한이 없습니다." }, { status: 403 });
  const { data, error } = await context.supabase.rpc("list_resource_share_members", { target_resource_id: id });
  return error ? databaseErrorResponse(error, "공유 목록을 불러오지 못했습니다.") : NextResponse.json({
    shares: data ?? [], actorRole: context.resourceRole,
    allowedRoles: context.resourceRole === "owner" ? shareRoles : shareRoles.slice(0, 2)
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManageShares) return NextResponse.json({ error: "공유 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  if (!isValidUsername(username)) return NextResponse.json({ error: "올바른 사용자 아이디를 입력해주세요." }, { status: 400 });
  if (!isShareRole(body.accessLevel)) return NextResponse.json({ error: "올바른 권한을 선택해주세요." }, { status: 400 });
  if (context.resourceRole !== "owner" && body.accessLevel === "admin") return NextResponse.json({ error: "관리자 권한은 소유자만 부여할 수 있습니다." }, { status: 403 });
  const { data, error } = await context.supabase.rpc("create_resource_share", { target_resource_id: id, target_username: username, target_access_level: body.accessLevel });
  return error ? databaseErrorResponse(error, "리소스를 공유하지 못했습니다.") : NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManageShares) return NextResponse.json({ error: "공유 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.shareId !== "string" || !["active", "pending"].includes(body.state) || !isShareRole(body.accessLevel)) {
    return NextResponse.json({ error: "올바른 공유 변경 요청이 아닙니다." }, { status: 400 });
  }
  if (context.resourceRole !== "owner" && body.accessLevel === "admin") return NextResponse.json({ error: "관리자 권한은 소유자만 변경할 수 있습니다." }, { status: 403 });
  const { data, error } = await context.supabase.rpc("update_resource_share_role", { target_share_id: body.shareId, target_state: body.state, next_access_level: body.accessLevel });
  return error ? databaseErrorResponse(error, "공유 권한을 바꾸지 못했습니다.") : NextResponse.json(data);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManageShares) return NextResponse.json({ error: "공유 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (typeof body.shareId !== "string" || !["active", "pending"].includes(body.state)) return NextResponse.json({ error: "올바른 공유 해제 요청이 아닙니다." }, { status: 400 });
  const { data, error } = await context.supabase.rpc("revoke_resource_share_role", { target_share_id: body.shareId, target_state: body.state });
  return error ? databaseErrorResponse(error, "공유 권한을 회수하지 못했습니다.") : NextResponse.json({ revoked: data });
}
