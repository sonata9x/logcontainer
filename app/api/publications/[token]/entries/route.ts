import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toLogEntryDto } from "@/lib/logs/dto";
import { enforceRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const limited = await enforceRateLimit(request, { scope: "published-log-read", maxRequests: 120, windowSeconds: 60, blockSeconds: 300 });
  if (limited) return limited;
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{12}$/.test(token)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const cursorValue = new URL(request.url).searchParams.get("after");
  const after = cursorValue && /^\d+$/.test(cursorValue) ? Number(cursorValue) : null;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_published_log", { publication_token: token, after_sort_key: after, batch_size: 50 });
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entries: ((data.entries ?? []) as Record<string, unknown>[]).map(toLogEntryDto), totalCount: data.totalCount ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
