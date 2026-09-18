"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminNavigation() {
  const pathname = usePathname();
  return <header className="admin-navigation"><strong>관리</strong><nav aria-label="사이트 관리">{[{ href: "/workspace/admin/accounts", label: "계정" }, { href: "/workspace/admin/bgm", label: "BGM" }].map((tab) => <Link key={tab.href} href={tab.href} aria-current={pathname === tab.href ? "page" : undefined}>{tab.label}</Link>)}</nav></header>;
}
