import { ok, readJson, withAuth } from "@/server/lib/api";
import { deleteCampaign, getCampaign, updateCampaign } from "@/server/services/campaign.service";
import { updateCampaignSchema } from "@/shared/campaign";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getCampaign(id));
});

/** Only draft or paused campaigns can be edited (409 otherwise). */
export const PATCH = withAuth<Params>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = updateCampaignSchema.parse(await readJson(request));
  return ok(await updateCampaign(id, input));
});

export const DELETE = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await deleteCampaign(id));
});
