import { getApiPageContext } from "@/lib/api-auth";
import { downloadPrivateArchive, gunzipArchive, ROLL20_SOURCE_BUCKET } from "@/lib/logs/archive";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  const { id, importId } = await params;
  const context = await getApiPageContext(id);
  if (!context || !context.isOriginalOwner) return new Response("Not found", { status: 404 });
  const { data: log } = await context.supabase.from("logs").select("id").eq("page_id", id).maybeSingle();
  if (!log) return new Response("Not found", { status: 404 });
  const { data: imported } = await context.supabase.from("log_imports").select("source_html, source_storage_path, compression, created_at").eq("id", importId).eq("log_id", log.id).maybeSingle();
  if (!imported) return new Response("Not found", { status: 404 });
  const stamp = imported.created_at.replace(/[:.]/g, "-");
  let source: Buffer;
  try {
    if (imported.source_storage_path) {
      const archived = await downloadPrivateArchive(ROLL20_SOURCE_BUCKET, imported.source_storage_path);
      source = imported.compression === "gzip" ? gunzipArchive(archived) : archived;
    } else if (typeof imported.source_html === "string") source = Buffer.from(imported.source_html, "utf8");
    else return new Response("Not found", { status: 404 });
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Uint8Array.from(source).buffer, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="roll20-backup-${stamp}.html"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    }
  });
}
