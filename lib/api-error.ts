import { NextResponse } from "next/server";

type DatabaseError = { code?: string | null; message?: string | null } | null | undefined;

export function databaseErrorResponse(error: DatabaseError, fallback: string, status = 400) {
  console.error("[api-database-error]", { code: error?.code ?? "unknown" });
  return NextResponse.json({ error: fallback }, { status, headers: { "Cache-Control": "no-store" } });
}

export function internalErrorResponse(error: unknown, fallback: string) {
  console.error("[api-internal-error]", { name: error instanceof Error ? error.name : "unknown" });
  return NextResponse.json({ error: fallback }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
