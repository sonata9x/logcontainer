import { randomBytes } from "node:crypto";

export function createPublicationToken() {
  return randomBytes(9).toString("base64url");
}
