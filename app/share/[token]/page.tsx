import type { Metadata } from "next";
import { GuestLog } from "@/components/GuestLog";

export const metadata: Metadata = { title: "Guest 로그", robots: { index: false, follow: false } };

export default async function GuestLogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuestLog token={token} />;
}
