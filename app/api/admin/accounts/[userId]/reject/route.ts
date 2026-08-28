import { NextResponse } from "next/server";
import { getSiteAdminApiContext } from "@/lib/admin-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const context = await getSiteAdminApiContext();
  if (!context) return NextResponse.json({ error: "사이트 관리자만 거절할 수 있습니다." }, { status: 403 });
  const { userId } = await params;
  const { data, error } = await context.supabase.rpc("moderate_account", { target_user_id: userId, decision: "reject" });
  return error ? databaseErrorResponse(error, "계정 신청을 거절하지 못했습니다.") : NextResponse.json({ account: data });
}
