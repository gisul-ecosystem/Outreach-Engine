import type { NextRequest } from "next/server";
import { handleError, ok, readJson } from "@/server/lib/api";
import { SESSION_COOKIE, sessionCookieOptions, signSessionToken } from "@/server/lib/auth";
import { login } from "@/server/services/auth.service";
import { loginSchema } from "@/shared/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const input = loginSchema.parse(await readJson(request));
    const user = await login(input);
    const token = await signSessionToken({ userId: user.id, email: user.email, role: user.role });

    const response = ok(user);
    response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
    return response;
  } catch (err) {
    return handleError(err);
  }
}
