// JWT session tokens + cookie settings.
// Uses ONLY `jose` (no Mongoose) because src/proxy.ts imports this file.
import { jwtVerify, SignJWT } from "jose";
import { getEnv } from "@/server/config/env";
import { USER_ROLES, type UserRole } from "@/shared/enums";

export const SESSION_COOKIE = "outreach_session";
const SESSION_DAYS = 7;
const SESSION_MAX_AGE_SECONDS = SESSION_DAYS * 24 * 60 * 60;
const ISSUER = "outreach-engine";
const ALGORITHM = "HS256";

export type SessionPayload = { userId: string; email: string; role: UserRole };

function secretKey(secret: string = getEnv().JWT_SECRET) {
  return new TextEncoder().encode(secret);
}

/** Creates a signed token that expires after 7 days. */
export async function signSessionToken(payload: SessionPayload, secret?: string): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(payload.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey(secret));
}

/** Returns the session if the token is valid and not expired, otherwise null (never throws). */
export async function verifySessionToken(
  token: string,
  secret?: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret), {
      issuer: ISSUER,
      algorithms: [ALGORITHM],
    });
    const role = payload.role as UserRole;
    if (!payload.sub || typeof payload.email !== "string" || !USER_ROLES.includes(role)) {
      return null;
    }
    return { userId: payload.sub, email: payload.email, role };
  } catch {
    return null;
  }
}

/** Cookie settings: httpOnly (JavaScript can't read it), sameSite lax, secure (HTTPS-only) in production. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getEnv().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/** Options that make the browser delete the session cookie. */
export function clearedSessionCookieOptions() {
  return { ...sessionCookieOptions(), maxAge: 0 };
}
