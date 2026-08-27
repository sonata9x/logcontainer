import { createHash } from "node:crypto";

export function stableRoll20Id(prefix: string, ...parts: unknown[]) {
  const digest = createHash("sha256").update(parts.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join("\u241f")).digest("hex").slice(0, 20);
  return `${prefix}_${digest}`;
}
