import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  const [{ data, error }, { data: events, error: eventError }] = await Promise.all([
    admin.rpc("purge_expired_resources"),
    admin.rpc("purge_stale_log_change_events")
  ]);
  const failure = error ?? eventError;
  return failure ? NextResponse.json({ error: failure.message }, { status: 400 }) : NextResponse.json({ purged: data ?? 0, purgedLogEvents: events ?? 0 });
}
