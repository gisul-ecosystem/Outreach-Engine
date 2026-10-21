import { ok, withAuth } from "@/server/lib/api";

export const runtime = "nodejs";

export const GET = withAuth(async (_request, { user }) => ok(user));
