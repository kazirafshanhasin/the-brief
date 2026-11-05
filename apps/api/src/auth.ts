import { SupabaseRest } from "@brief/core";
import { HttpError } from "./http";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 random bytes, base64url. The device keeps it; the server stores only its SHA-256. */
export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Authorization: Bearer <installation_id>.<secret>
 * The installation id alone is never enough to change anything.
 */
export async function authenticate(request: Request, db: SupabaseRest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+([0-9a-f-]{36})\.([A-Za-z0-9_-]{20,})$/i.exec(header);
  if (!m || !UUID_RE.test(m[1]!)) throw new HttpError(401, "Missing or malformed device credentials");
  const [, id, secret] = m as unknown as [string, string, string];
  const rows = await db.select<{ id: string; secret_hash: string }>("installations", `select=id,secret_hash&id=eq.${id}`);
  const row = rows[0];
  const hash = await sha256Hex(secret);
  if (!row || !timingSafeEqual(hash, row.secret_hash)) throw new HttpError(401, "Invalid device credentials");
  return id;
}
