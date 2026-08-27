import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { isValidUsername, normalizeUsername } from "@/lib/auth-identity";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canInvite) return NextResponse.json({ error: "공유 권한이 없습니다." }, { status: 403 });
  if (!context.canManage) return NextResponse.json({ shares: [], canManage: false, canInvite: true });
  const { data, error } = await context.supabase.rpc("list_resource_shares", { target_resource_id: id });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ shares: data ?? [], canManage: true, canInvite: true });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canInvite) return NextResponse.json({ error: "공유 권한이 없습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  if (!isValidUsername(username)) return NextResponse.json({ error: "올바른 사용자 아이디를 입력해주세요." }, { status: 400 });
  const canInvite = context.canManage && body.canInvite === true;
  const { data, error } = await context.supabase.rpc("share_resource", { target_resource_id: id, target_username: username, grant_can_invite: canInvite });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManage) return NextResponse.json({ error: "최초 소유자만 초대 권한을 변경할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const { data, error } = await context.supabase.rpc("set_resource_share_invite", { target_share_id: body.shareId, next_can_invite: body.canInvite === true });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context?.canManage) return NextResponse.json({ error: "최초 소유자만 공유 권한을 회수할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const rpc = body.state === "pending" ? "revoke_pending_resource_share" : "revoke_resource_share";
  const key = body.state === "pending" ? "target_pending_share_id" : "target_share_id";
  const { data, error } = await context.supabase.rpc(rpc, { [key]: body.shareId });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ revoked: data });
}
