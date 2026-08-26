import { getApiPageContext } from "@/lib/api-auth";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  const { id, importId } = await params;
  const context = await getApiPageContext(id);
  if (!context) return new Response("Not found", { status: 404 });
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).maybeSingle();
  if (!log) return new Response("Not found", { status: 404 });
  const { data: imported } = await context.supabase.from("log_imports").select("source_html, created_at").eq("id", importId).eq("log_id", log.id).maybeSingle();
  if (!imported) return new Response("Not found", { status: 404 });
  const stamp = imported.created_at.replace(/[:.]/g, "-");
  return new Response(imported.source_html, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="roll20-backup-${stamp}.html"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
}
