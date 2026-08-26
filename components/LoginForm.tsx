"use client";

import { FormEvent, useState } from "react";

export function LoginForm() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: data.get("username"), password: data.get("password") }) });
    const result = await response.json();

    if (!response.ok) {
      setError(result.error ?? "아이디 또는 비밀번호를 확인해주세요.");
      setPending(false);
      return;
    }
    window.location.assign("/workspace");
  }

  return (
    <form onSubmit={submit}>
      <label className="field">아이디<input name="username" autoComplete="username" minLength={2} maxLength={40} required /></label>
      <label className="field">비밀번호<input name="password" type="password" autoComplete="current-password" minLength={4} required /></label>
      {error && <p className="error">{error}</p>}
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? "로그인 중…" : "로그인"}</button>
    </form>
  );
}
