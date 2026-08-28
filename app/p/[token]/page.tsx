import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { PublicLog } from "@/components/PublicLog";
import { PublicationPasswordGate } from "@/components/PublicationPasswordGate";
import { toLogEntryDto } from "@/lib/logs/dto";
import { getPublishedLog } from "@/lib/logs/published";
import { getPublicationAccess, PUBLICATION_SESSION_COOKIE } from "@/lib/publication-auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function PublishedLogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const cookieStore = await cookies();
  const access = await getPublicationAccess(token, cookieStore.get(PUBLICATION_SESSION_COOKIE)?.value);
  if (!access) notFound();
  if (!access.authorized) return <PublicationPasswordGate token={token} />;
  const published = await getPublishedLog(token);
  if (!published) notFound();
  const entries = published.entries.map(toLogEntryDto);
  return <PublicLog token={token} title={published.page.title} initialEntries={entries} totalCount={published.totalCount ?? entries.length} />;
}
