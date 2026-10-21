import { ok, searchParams, withAuth } from "@/server/lib/api";
import { getDashboardTimeline } from "@/server/services/dashboard.service";
import { timelineQuerySchema } from "@/shared/dashboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const { days } = timelineQuerySchema.parse(searchParams(request));
  return ok(await getDashboardTimeline(days));
});
