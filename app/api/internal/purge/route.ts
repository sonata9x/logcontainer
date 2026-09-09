import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { purgeExpiredResourceHandoutImages, purgeStaleHandoutUploads } from "@/lib/handouts";
import { purgeExpiredImportUploads } from "@/lib/logs/import-upload";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 401 });
  }
  const admin = createSupabaseAdminClient();
  try {
    // Private Storage has no foreign-key cascade. Remove expired page assets before
    // the database rows disappear, so their paths remain discoverable on retry.
    const purgedExpiredHandoutImages = await purgeExpiredResourceHandoutImages(admin);
    const [{ data, error }, { data: events, error: eventError }, { data: rateLimits, error: rateLimitError }, { data: sessions, error: sessionError }, purgedImportUploads, purgedStaleHandoutUploads] = await Promise.all([
      admin.rpc("purge_expired_resources"),
      admin.rpc("purge_stale_log_change_events"),
      admin.rpc("purge_security_rate_limits"),
      admin.rpc("purge_expired_external_sessions"),
      purgeExpiredImportUploads(),
      purgeStaleHandoutUploads(admin)
    ]);
    const failure = error ?? eventError ?? rateLimitError ?? sessionError;
    if (failure) {
      console.error("[purge] failed", { code: failure.code ?? "unknown" });
      return NextResponse.json({ error: "정리 작업을 완료하지 못했습니다." }, { status: 500 });
    }
    return NextResponse.json({ purged: data ?? 0, purgedLogEvents: events ?? 0, purgedRateLimits: rateLimits ?? 0, purgedExternalSessions: sessions ?? 0, purgedImportUploads, purgedExpiredHandoutImages, purgedStaleHandoutUploads });
  } catch (error) {
    console.error("[purge] failed", { name: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "정리 작업을 완료하지 못했습니다." }, { status: 500 });
  }
}
