import { notFound } from "next/navigation";
import Link from "next/link";
import { requireWorkspaceSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireWorkspaceSession();
  if (!session.profile.is_site_admin) notFound();
  return <div className="admin-area"><header className="admin-navigation"><strong>관리</strong><nav aria-label="사이트 관리"><Link href="/workspace/admin/accounts">계정</Link><Link href="/workspace/admin/bgm">BGM</Link></nav></header>{children}</div>;
}
