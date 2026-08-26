"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function SetPasswordForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirm = String(data.get("confirm") ?? "");
    if (password.length < 8 || password !== confirm) {
      setError(password.length < 8 ? "비밀번호는 8자 이상이어야 합니다." : "비밀번호가 서로 다릅니다.");
      setPending(false);
      return;
    }
    const { error: updateError } = await createSupabaseBrowserClient().auth.updateUser({ password });
    if (updateError) {
      setError("비밀번호를 설정하지 못했습니다. 초대 링크를 다시 확인해주세요.");
      setPending(false);
      return;
    }
    window.location.assign("/workspace");
  }
  return <form onSubmit={submit}><label className="field">새 비밀번호<input name="password" type="password" minLength={8} required /></label><label className="field">비밀번호 확인<input name="confirm" type="password" minLength={8} required /></label>{error && <p className="error">{error}</p>}<button className="button button-primary" disabled={pending}>{pending ? "설정 중…" : "비밀번호 설정"}</button></form>;
}
