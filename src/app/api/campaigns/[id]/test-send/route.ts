import { ok, readJson, withAuth } from "@/server/lib/api";
import { testSendCampaign } from "@/server/services/campaign.service";
import { testSendCampaignSchema } from "@/shared/campaign";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

/** "Send test to myself": this campaign's email to one address (simulated while DRY_RUN=true). */
export const POST = withAuth<{ id: string }>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = testSendCampaignSchema.parse(await readJson(request));
  return ok(await testSendCampaign(id, input));
});
