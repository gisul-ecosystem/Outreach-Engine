// Tracking-link tokens: the random part of https://go.racko.ai/r/<token>.
// 12 characters from crypto.randomBytes (72 random bits) — unguessable, and they never contain the
// email, the name or anything else about the person.
import { randomBytes } from "node:crypto";

/** What a token may look like in a URL (letters, digits, "-" and "_"). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{10,32}$/;

/** A new random token, e.g. "k7f2Qa9xLm_3". */
export function newToken(): string {
  return randomBytes(9).toString("base64url");
}

export function isTokenFormat(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

/** The full link for a token: `${TRACKING_BASE_URL}/r/${token}`. */
export function linkUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/r/${token}`;
}

/**
 * Every token that appears as …/r/<token> in an email body (HTML or text), without duplicates.
 * Only used to find our links in hand-sent emails; the body itself is never stored.
 */
export function findLinkTokens(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\/r\/([A-Za-z0-9_-]{10,32})(?![A-Za-z0-9_-])/g)) {
    found.add(match[1]);
  }
  return [...found];
}
