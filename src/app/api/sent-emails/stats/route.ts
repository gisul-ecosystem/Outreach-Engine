import { ok, searchParams, withAuth } from "@/server/lib/api";
import { getTrackedStats } from "@/server/services/tracked-email.service";
import { trackedStatsQuerySchema } from "@/shared/tracked-email";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = trackedStatsQuerySchema.parse(searchParams(request));
  return ok(await getTrackedStats(query));
});
