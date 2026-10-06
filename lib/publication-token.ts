import { randomBytes } from "node:crypto";

export function createPublicationToken() {
  return randomBytes(9).toString("base64url");
}

export function publicationTokenForConfiguration(existing: { token?: unknown; is_active?: unknown } | null | undefined, createToken = createPublicationToken) {
  return existing?.is_active === true && typeof existing.token === "string" && /^[A-Za-z0-9_-]{12}$/.test(existing.token)
    ? existing.token
    : createToken();
}
