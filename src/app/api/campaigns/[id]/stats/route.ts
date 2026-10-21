import { ok, withAuth } from "@/server/lib/api";
import { getCampaignStats } from "@/server/services/campaign.service";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

/** Counts per status, audience, daily capacity and ETA. */
export const GET = withAuth<{ id: string }>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getCampaignStats(id));
});
