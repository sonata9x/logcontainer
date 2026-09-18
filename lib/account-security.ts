import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { deriveAuthPassword } from "@/lib/auth-identity";
import { getPublicSupabaseEnv } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export function createRecoverySecret() { return randomBytes(32).toString("base64url"); }
export function recoverySecretHash(value: string) { return createHash("sha256").update(`logcontainer-recovery-v1\0${value}`).digest("hex"); }
export function validRecoverySecret(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value); }
export function validAccountPassword(value: unknown): value is string { return typeof value === "string" && value.length >= 4 && value.length <= 200; }
export function validCurrentAccountPassword(value: unknown): value is string { return typeof value === "string" && value.length >= 4; }

// Reauthentication must never replace the browser's session as a side effect.
export async function verifyAccountPassword(userId: string, password: string) {
  if (!validCurrentAccountPassword(password)) return false;
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error("Account authentication unavailable");
  const { url, anonKey } = getPublicSupabaseEnv();
  const isolated = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const result = await isolated.auth.signInWithPassword({ email: data.user.email, password: deriveAuthPassword(password) });
  if (result.data.session) await isolated.auth.signOut({ scope: "local" });
  return !result.error && result.data.user?.id === userId;
}

export async function recordReauthenticationFailure(userId: string) {
  await recordAccountSecurityEvent(userId, "reauth_failed", userId);
}
export async function recordAccountSecurityEvent(userId: string, action: "reauth_failed" | "login_failed" | "request_limited", actorId: string | null = null) {
  const { error } = await createSupabaseAdminClient().from("account_security_events").insert({ user_id: userId, actor_id: actorId, action });
  if (error) console.error("[account-security-audit] unavailable", { code: error.code });
}

type PasswordOperation = { userId: string; operationId: string; recovery: boolean };
export async function runAccountPasswordUpdate(admin: ReturnType<typeof createSupabaseAdminClient>, password: string, claim: { target_user_id?: string; recovery_hash?: string }) {
  const { data, error } = await admin.rpc("begin_account_password_update", claim);
  if (error || !data) throw new Error("복구 정보가 만료·사용되었거나 계정 처리가 진행 중입니다.");
  const operation = data as PasswordOperation;
  let succeeded = false;
  try {
    const result = await admin.auth.admin.updateUserById(operation.userId, { password: deriveAuthPassword(password) });
    if (result.error) throw new Error("비밀번호를 변경하지 못했습니다. 새 복구 링크를 요청하거나 다시 시도해주세요.");
    succeeded = true;
  } catch {
    throw new Error("비밀번호 변경을 확인하지 못해 계정 접근을 보호 상태로 잠갔습니다. 관리자에게 중단된 처리 해제를 요청해주세요.");
  } finally {
    const { error: finishError } = await admin.rpc("finish_account_password_update", { target_user_id: operation.userId, operation_id: operation.operationId, succeeded, was_recovery: operation.recovery });
    // Retain fail-closed pending state if durable finalization is unavailable.
    if (finishError) throw new Error("계정 보안 처리를 완료하지 못했습니다. 관리자에게 문의해주세요.");
  }
}
