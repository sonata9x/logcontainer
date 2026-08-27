import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LogEntryBlock } from "@/components/LogEntryBlock";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { LogEntry, WorkspacePage } from "@/lib/types";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PublishedLogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createSupabaseAdminClient();
  const { data: publication } = await admin.from("publications").select("page_id, published_at").eq("token", token).eq("is_active", true).maybeSingle();
  if (!publication) notFound();
  const { data: page } = await admin.from("pages").select("*").eq("id", publication.page_id).eq("page_type", "log").eq("is_archived", false).is("deleted_at", null).maybeSingle();
  if (!page) notFound();
  const { data: log } = await admin.from("logs").select("id").eq("page_id", page.id).maybeSingle();
  if (!log) notFound();
  const { data: entries } = await admin.from("log_entries").select("*").eq("log_id", log.id).eq("is_deleted", false).order("order_index");

  return (
    <main className="public-log">
      <h1>{(page as WorkspacePage).title}</h1>
      <section>{((entries ?? []) as LogEntry[]).map((entry) => <LogEntryBlock key={entry.id} entry={entry} />)}</section>
    </main>
  );
}
