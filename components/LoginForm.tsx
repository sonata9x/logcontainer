"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const supabase = createSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? "")
    });

    if (signInError) {
      setError("이메일 또는 비밀번호를 확인해주세요.");
      setPending(false);
      return;
    }
    window.location.assign("/workspace");
  }

  return (
    <form onSubmit={submit}>
      <label className="field">이메일<input name="email" type="email" autoComplete="email" required /></label>
      <label className="field">비밀번호<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="error">{error}</p>}
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? "로그인 중…" : "로그인"}</button>
    </form>
  );
}
