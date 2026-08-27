import { NextResponse } from "next/server";
import { getSiteAdminApiContext } from "@/lib/admin-auth";

const STATUSES = new Set(["pending", "approved", "rejected", "disabled"]);

export async function GET(request: Request) {
  const context = await getSiteAdminApiContext();
  if (!context) return NextResponse.json({ error: "사이트 관리자만 계정을 관리할 수 있습니다." }, { status: 403 });
  const requestedStatus = new URL(request.url).searchParams.get("status") ?? "pending";
  const status = STATUSES.has(requestedStatus) ? requestedStatus : "pending";
  const { data, error } = await context.admin.from("profiles")
    .select("id, username, display_name, account_status, is_site_admin, approved_at, approved_by, created_at, updated_at")
    .eq("account_status", status).order("created_at");
  return error ? NextResponse.json({ error: error.message }, { status: 400 }) : NextResponse.json({ accounts: data ?? [] });
}
