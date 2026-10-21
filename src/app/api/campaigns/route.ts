import { ok, okPage, readJson, searchParams, withAuth } from "@/server/lib/api";
import { createCampaign, listCampaigns } from "@/server/services/campaign.service";
import { createCampaignSchema, listCampaignsQuerySchema } from "@/shared/campaign";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listCampaignsQuerySchema.parse(searchParams(request));
  return okPage(await listCampaigns(query));
});

export const POST = withAuth(async (request) => {
  const input = createCampaignSchema.parse(await readJson(request));
  return ok(await createCampaign(input), 201);
});
