import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicLog } from "@/components/PublicLog";
import { toLogEntryDto } from "@/lib/logs/dto";
import { getCachedPublishedLog } from "@/lib/logs/published";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PublishedLogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const published = await getCachedPublishedLog(token);
  if (!published) notFound();
  const entries = published.entries.map(toLogEntryDto);
  return <PublicLog token={token} title={published.page.title} initialEntries={entries} totalCount={published.totalCount ?? entries.length} />;
}
