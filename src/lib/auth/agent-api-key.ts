import { createHash, randomBytes } from "crypto";
import { db } from "@/lib/db";

const SALT = process.env.API_KEY_HASH_SALT ?? "change-me-in-production";

export function generateApiKey(): string {
  // 32 random bytes, base64url. Prefixed for easy recognition in logs.
  return "agt_" + randomBytes(32).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(SALT + key).digest("hex");
}

export async function authenticateAgent(apiKey: string | null) {
  if (!apiKey) return null;
  const hash = hashApiKey(apiKey);
  return db.agent.findUnique({ where: { apiKeyHash: hash } });
}

/** Extract an API key from a Next.js request. Accepts Authorization: Bearer <key> or x-api-key header. */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  const x = req.headers.get("x-api-key");
  if (x) return x.trim();
  return null;
}
