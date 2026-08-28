import { NextRequest, NextResponse } from "next/server";
import { toLogEntryDto } from "@/lib/logs/dto";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getPublicationAccess, PUBLICATION_SESSION_COOKIE } from "@/lib/publication-auth";
import { getPublishedLog } from "@/lib/logs/published";

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = await enforceRateLimit(request, { scope: "published-log-read", maxRequests: 120, windowSeconds: 60, blockSeconds: 300 });
  if (limited) return limited;
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{12}$/.test(token)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const cursorValue = new URL(request.url).searchParams.get("after");
  const after = cursorValue && /^\d+$/.test(cursorValue) ? Number(cursorValue) : null;
  const access = await getPublicationAccess(token, request.cookies.get(PUBLICATION_SESSION_COOKIE)?.value);
  if (!access?.authorized) return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const data = await getPublishedLog(token, after);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ entries: ((data.entries ?? []) as Record<string, unknown>[]).map(toLogEntryDto), totalCount: data.totalCount ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}
