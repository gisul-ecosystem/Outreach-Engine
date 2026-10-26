// The visitor's IP address — used ONLY in memory to make `ipHash`; the raw IP is never stored or logged.
import { createHmac } from "node:crypto";

/**
 * - TRUST_PROXY=true (behind Nginx or Cloudflare): CF-Connecting-IP, else X-Real-IP, else the LAST entry
 *   of X-Forwarded-For (the one our own proxy added — earlier entries can be typed in by anyone).
 * - TRUST_PROXY=false: Next.js puts the direct connection address in X-Forwarded-For when the request
 *   did not already have one, so the last entry is used (a visitor could fake it, which only affects
 *   the rate limit and the scrambled IP, never where the link goes).
 */
export function clientIp(headers: Headers, trustProxy: boolean): string | null {
  if (trustProxy) {
    const direct = headers.get("cf-connecting-ip") ?? headers.get("x-real-ip");
    if (direct?.trim()) return direct.trim();
  }
  const forwarded = headers.get("x-forwarded-for");
  const last = forwarded?.split(",").at(-1)?.trim();
  return last || null;
}

/**
 * HMAC-SHA256 of the IP with a secret key: the same IP always gives the same code (so repeat visits are
 * recognised), but the code cannot be turned back into the IP, and without the key nobody can test guesses.
 */
export function hashIp(ip: string, secret: string): string {
  return createHmac("sha256", secret).update(ip).digest("base64url");
}
