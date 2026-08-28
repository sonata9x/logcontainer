import { NextResponse } from "next/server";
import { getApiPageContext } from "@/lib/api-auth";
import { databaseErrorResponse } from "@/lib/api-error";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await getApiPageContext(id);
  if (!context || context.isOriginalOwner) return NextResponse.json({ error: "공유받은 리소스만 제거할 수 있습니다." }, { status: 403 });
  const { data, error } = await context.supabase.rpc("self_remove_resource", { target_resource_id: id });
  return error ? databaseErrorResponse(error, "공유 리소스를 제거하지 못했습니다.") : NextResponse.json({ removed: data });
}
