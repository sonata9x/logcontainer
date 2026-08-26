import { NextResponse } from "next/server";
import { getApiWorkspaceContext } from "@/lib/api-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const context = await getApiWorkspaceContext(workspaceId);
  if (!context) return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  const { data: memberships, error } = await context.supabase.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", workspaceId).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const userIds = (memberships ?? []).map((membership) => membership.user_id);
  const { data: profiles } = userIds.length ? await context.supabase.from("profiles").select("id, email, display_name").in("id", userIds) : { data: [] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return NextResponse.json({ members: (memberships ?? []).map((membership) => ({ ...membership, profile: profileById.get(membership.user_id) ?? null })) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "올바른 이메일을 입력해주세요." }, { status: 400 });

  const context = await getApiWorkspaceContext(workspaceId);
  if (!context || context.role !== "owner") return NextResponse.json({ error: "워크스페이스 소유자만 초대할 수 있습니다." }, { status: 403 });

  const admin = createSupabaseAdminClient();
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 400 });
  let invitedUser = listed.users.find((user) => user.email?.toLowerCase() === email) ?? null;

  const { error: invitationError } = await admin.from("workspace_invitations").upsert({
    workspace_id: workspaceId,
    email,
    created_by: context.user.id,
    accepted_by: null,
    accepted_at: null,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  }, { onConflict: "workspace_id,email" });
  if (invitationError) return NextResponse.json({ error: invitationError.message }, { status: 400 });

  if (!invitedUser) {
    const redirectTo = new URL("/auth/callback?next=/set-password", request.url).toString();
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) {
      await admin.from("workspace_invitations").delete().eq("workspace_id", workspaceId).eq("email", email).is("accepted_at", null);
      return NextResponse.json({ error: error?.message ?? "사용자를 초대하지 못했습니다." }, { status: 400 });
    }
    invitedUser = data.user;
  }

  if (invitedUser.id === context.user.id) return NextResponse.json({ error: "본인은 이미 소유자입니다." }, { status: 400 });
  const { error: memberError } = await admin.from("workspace_members").upsert({ workspace_id: workspaceId, user_id: invitedUser.id, role: "editor" }, { onConflict: "workspace_id,user_id" });
  if (!memberError) {
    await admin.from("workspace_invitations").update({ accepted_by: invitedUser.id, accepted_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("email", email);
  }
  return memberError ? NextResponse.json({ error: memberError.message }, { status: 400 }) : NextResponse.json({ email, role: "editor" }, { status: 201 });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const userId = typeof body.userId === "string" ? body.userId : "";
  const context = await getApiWorkspaceContext(workspaceId);
  if (!context || context.role !== "owner") return NextResponse.json({ error: "워크스페이스 소유자만 멤버를 내보낼 수 있습니다." }, { status: 403 });
  if (!userId || userId === context.user.id) return NextResponse.json({ error: "소유자는 내보낼 수 없습니다." }, { status: 400 });
  const { error } = await context.supabase.from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId).eq("role", "editor");
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ removed: true });
}
