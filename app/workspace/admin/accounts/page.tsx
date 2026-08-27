import { notFound } from "next/navigation";
import { AccountApprovalPanel } from "@/components/AccountApprovalPanel";
import { requireWorkspaceSession } from "@/lib/auth";

export default async function AdminAccountsPage() {
  const session = await requireWorkspaceSession();
  if (!session.profile.is_site_admin) notFound();
  return <AccountApprovalPanel />;
}
