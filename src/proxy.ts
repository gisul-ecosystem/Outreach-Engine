// Runs before every page and API request (Next.js 16 "proxy", formerly "middleware").
// Only checks the JWT with `jose` — never touches the database. Route handlers still check
// the user themselves with withAuth(), so this is the first line of defence, not the only one.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/server/lib/auth";

const LOGIN_PATH = "/login";

function isPublicApi(pathname: string) {
  return pathname === "/api/health" || pathname.startsWith("/api/auth/");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname === "/api" || pathname.startsWith("/api/");

  if (isApi && isPublicApi(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (pathname === LOGIN_PATH) {
    // Already signed in → no need to see the login page.
    return session ? NextResponse.redirect(new URL("/", request.url)) : NextResponse.next();
  }

  if (session) return NextResponse.next();

  if (isApi) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Please log in" } },
      { status: 401 },
    );
  }
  return NextResponse.redirect(new URL(LOGIN_PATH, request.url));
}

export const config = {
  // Everything except Next.js internals and static files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
