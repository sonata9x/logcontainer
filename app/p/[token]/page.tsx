import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { PublicLog } from "@/components/PublicLog";
import { PublicationPasswordGate } from "@/components/PublicationPasswordGate";
import { toLogEntryDto } from "@/lib/logs/dto";
import { getPublishedLog } from "@/lib/logs/published";
import { getPublicationAccess, PUBLICATION_SESSION_COOKIE } from "@/lib/publication-auth";
import { parseLogFontFamily } from "@/lib/fonts";
import { LogFontPreload } from "@/components/logs/LogFontPreload";
import { getSpeakerAvatarBundle } from "@/lib/speaker-avatars";

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
  const fontFamily = parseLogFontFamily(access.page.font_family);
  const initialAvatars = await getSpeakerAvatarBundle(access.admin, access.page.id);
  return <><LogFontPreload font={fontFamily} /><PublicLog token={token} title={published.page.title} initialEntries={entries} totalCount={published.totalCount ?? entries.length} initialAvatars={initialAvatars} initialFontFamily={fontFamily} key={token} /></>;
}
