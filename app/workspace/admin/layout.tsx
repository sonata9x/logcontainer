import { notFound } from "next/navigation";
import { AdminNavigation } from "@/components/AdminNavigation";
import { requireWorkspaceSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspaceSession();
  if (!session.profile.is_site_admin) notFound();
  return <div className="admin-area"><AdminNavigation />{children}</div>;
}
