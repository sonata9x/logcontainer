import { NextResponse } from "next/server";
import { getSiteAdminApiContext } from "@/lib/admin-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const context = await getSiteAdminApiContext();
  if (!context) return NextResponse.json({ error: "사이트 관리자만 거절할 수 있습니다." }, { status: 403 });
  const { userId } = await params;
  const { data, error } = await context.supabase.rpc("moderate_account", { target_user_id: userId, decision: "reject" });
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ account: data });
}
