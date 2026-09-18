import type { Metadata } from "next";
import { AccountRecoveryForm } from "@/components/AccountRecoveryForm";

export const metadata: Metadata = { title: "계정 비밀번호 복구", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default function AccountRecoveryPage() { return <main className="auth-page"><section className="auth-card"><h1>비밀번호 복구</h1><AccountRecoveryForm /></section></main>; }
