// Single-user session: one password from SITE_PASSWORD, kept in a signed HttpOnly cookie.
// Used by src/proxy.ts and re-checked on the server before any portfolio data is read.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "pc_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters");
  return s;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

const safeEqual = (a: string, b: string) => {
  // Hash first so lengths always match and timing doesn't leak length
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
};

export function checkPassword(candidate: string): boolean {
  const expected = process.env.SITE_PASSWORD;
  if (!expected) throw new Error("SITE_PASSWORD must be set");
  return safeEqual(candidate, expected);
}

/** Cookie value: "<expiresAtMs>.<hmac>" */
export function createSessionValue(now = Date.now()): string {
  const expires = String(now + SESSION_TTL_SECONDS * 1000);
  return `${expires}.${sign(expires)}`;
}

export function isValidSession(value: string | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot <= 0) return false;
  const expires = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!/^\d+$/.test(expires) || Number(expires) < now) return false;
  try {
    return safeEqual(mac, sign(expires));
  } catch {
    return false;
  }
}
