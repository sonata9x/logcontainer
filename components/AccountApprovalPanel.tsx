"use client";

import { useEffect, useState } from "react";
import type { AccountStatus, Profile } from "@/lib/types";

const FILTERS: Array<{ value: AccountStatus; label: string }> = [
  { value: "pending", label: "승인 대기" },
  { value: "approved", label: "승인됨" },
  { value: "rejected", label: "거절됨" },
  { value: "disabled", label: "사용 중지" }
];

export function AccountApprovalPanel() {
  const [status, setStatus] = useState<AccountStatus>("pending");
  const [accounts, setAccounts] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  async function load(nextStatus = status) {
    setLoading(true);
    const response = await fetch(`/api/admin/accounts?status=${nextStatus}`);
    const result = await response.json();
    setLoading(false);
    if (!response.ok) return window.alert(result.error ?? "계정을 불러오지 못했습니다.");
    setAccounts(result.accounts ?? []);
  }

  useEffect(() => { void load(status); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  async function moderate(userId: string, decision: "approve" | "reject") {
    if (decision === "reject" && !window.confirm("이 가입 신청을 거절할까요? 계정 기록은 보존됩니다.")) return;
    setActing(userId);
    const response = await fetch(`/api/admin/accounts/${userId}/${decision}`, { method: "POST" });
    const result = await response.json();
    setActing(null);
    if (!response.ok) return window.alert(result.error ?? "계정 상태를 변경하지 못했습니다.");
    await load();
  }

  return <section className="admin-accounts">
    <header><h1>계정 관리</h1><p>가입 승인과 리소스 공유 권한은 서로 독립적으로 관리됩니다.</p></header>
    <div className="status-tabs">{FILTERS.map((filter) => <button key={filter.value} className={`button ${status === filter.value ? "active" : ""}`} onClick={() => setStatus(filter.value)}>{filter.label}</button>)}</div>
    {loading ? <p>불러오는 중…</p> : accounts.length ? <div className="account-list">{accounts.map((account) => <article className="account-row" key={account.id}>
      <div><strong>{account.display_name || account.username}</strong><small>@{account.username} · 신청 {new Date(account.created_at).toLocaleDateString("ko-KR")}{account.is_site_admin ? " · 사이트 관리자" : ""}</small></div>
      {!account.is_site_admin && <div className="account-actions">
        {account.account_status !== "approved" && <button className="button button-primary" disabled={acting === account.id} onClick={() => moderate(account.id, "approve")}>승인</button>}
        {account.account_status !== "rejected" && <button className="button button-danger" disabled={acting === account.id} onClick={() => moderate(account.id, "reject")}>거절</button>}
      </div>}
    </article>)}</div> : <p className="muted">해당 상태의 계정이 없습니다.</p>}
  </section>;
}
