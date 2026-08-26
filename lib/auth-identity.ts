import { createHash, randomUUID } from "node:crypto";

export const USERNAME_PATTERN = /^[a-z0-9가-힣._-]{2,40}$/;

export function normalizeUsername(value: unknown) {
  return typeof value === "string" ? value.trim().toLocaleLowerCase("ko-KR") : "";
}

export function isValidUsername(username: string) {
  return USERNAME_PATTERN.test(username);
}

export function createInternalAuthEmail() {
  return `${randomUUID()}@auth.logcontainer.local`;
}

export function deriveAuthPassword(password: string) {
  return createHash("sha256").update("logcontainer-auth-v1\0").update(password, "utf8").digest("hex");
}
