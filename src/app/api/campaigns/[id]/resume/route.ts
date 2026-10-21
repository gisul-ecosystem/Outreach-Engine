import { ok, withAuth } from "@/server/lib/api";
import { resumeCampaign } from "@/server/services/campaign.service";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await resumeCampaign(id));
});
