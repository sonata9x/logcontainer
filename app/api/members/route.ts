import { NextResponse } from "next/server";
import { getApiWorkspaceContext } from "@/lib/api-auth";
import { createInternalAuthEmail, deriveAuthPassword, isValidUsername, normalizeUsername } from "@/lib/auth-identity";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
  const context = await getApiWorkspaceContext(workspaceId);
  if (!context) return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  const { data: memberships, error } = await context.supabase.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", workspaceId).order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const userIds = (memberships ?? []).map((membership) => membership.user_id);
  const { data: profiles } = userIds.length ? await context.supabase.from("profiles").select("id, username, display_name").in("id", userIds) : { data: [] };
  const profileById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return NextResponse.json({ members: (memberships ?? []).map((membership) => ({ ...membership, profile: profileById.get(membership.user_id) ?? null })) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  if (!isValidUsername(username) || password.length < 4) return NextResponse.json({ error: "아이디는 2~40자, 임시 비밀번호는 4자 이상으로 입력해주세요." }, { status: 400 });

  const context = await getApiWorkspaceContext(workspaceId);
  if (!context || context.role !== "owner") return NextResponse.json({ error: "워크스페이스 소유자만 편집자 계정을 추가할 수 있습니다." }, { status: 403 });

  const admin = createSupabaseAdminClient();
  const { data: existingProfile, error: profileError } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 400 });
  if (existingProfile?.id === context.user.id) return NextResponse.json({ error: "본인은 이미 소유자입니다." }, { status: 400 });
  let userId = existingProfile?.id ?? null;

  const { error: pendingError } = await admin.from("pending_accounts").upsert({
    workspace_id: workspaceId,
    username,
    created_by: context.user.id,
    accepted_by: null,
    accepted_at: null,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  }, { onConflict: "workspace_id,username" });
  if (pendingError) return NextResponse.json({ error: pendingError.message }, { status: 400 });

  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({ email: createInternalAuthEmail(), password: deriveAuthPassword(password), email_confirm: true, user_metadata: { username, display_name: username } });
    if (error || !data.user) {
      await admin.from("pending_accounts").delete().eq("workspace_id", workspaceId).eq("username", username).is("accepted_at", null);
      return NextResponse.json({ error: error?.message ?? "사용자를 만들지 못했습니다." }, { status: 400 });
    }
    userId = data.user.id;
  }

  const { error: memberError } = await admin.from("workspace_members").upsert({ workspace_id: workspaceId, user_id: userId, role: "editor" }, { onConflict: "workspace_id,user_id" });
  if (!memberError) {
    await admin.from("pending_accounts").update({ accepted_by: userId, accepted_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("username", username);
  }
  return memberError ? NextResponse.json({ error: memberError.message }, { status: 400 }) : NextResponse.json({ username, role: "editor" }, { status: 201 });
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
