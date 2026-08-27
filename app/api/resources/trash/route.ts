import { NextResponse } from "next/server";
import { getApiWorkspaceContext } from "@/lib/api-auth";

export async function GET() {
  const context = await getApiWorkspaceContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data, error } = await context.supabase.from("pages").select("id, page_type, title, deleted_at, purge_after").eq("original_owner_id", context.user.id).not("deleted_at", "is", null).order("deleted_at", { ascending: false });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ resources: data ?? [] });
}

export async function POST(request: Request) {
  const context = await getApiWorkspaceContext();
  if (!context) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const rpc = body.permanent === true ? "permanently_delete_resource" : "restore_resource";
  const { data, error } = await context.supabase.rpc(rpc, { target_resource_id: body.resourceId });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json(data);
}
