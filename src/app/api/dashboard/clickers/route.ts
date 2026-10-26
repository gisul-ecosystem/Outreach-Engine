import { ok, searchParams, withAuth } from "@/server/lib/api";
import { getDashboardClickers } from "@/server/services/dashboard.service";
import { clickersQuerySchema } from "@/shared/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clicks per person (tracking links), most real clicks first. */
export const GET = withAuth(async (request) => {
  const { period, limit } = clickersQuerySchema.parse(searchParams(request));
  return ok(await getDashboardClickers(period, limit));
});
