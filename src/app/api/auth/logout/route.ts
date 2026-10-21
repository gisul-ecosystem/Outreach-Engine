import { ok } from "@/server/lib/api";
import { clearedSessionCookieOptions, SESSION_COOKIE } from "@/server/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = ok({ loggedOut: true });
  response.cookies.set(SESSION_COOKIE, "", clearedSessionCookieOptions());
  return response;
}
