import { ok, withAuth } from "@/server/lib/api";
import { startCampaign } from "@/server/services/campaign.service";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

/** Creates the queue (one message per contact) and sets the campaign to running. Sends nothing itself. */
export const POST = withAuth<{ id: string }>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await startCampaign(id));
});
