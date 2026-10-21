import { okPage, searchParams, withAuth } from "@/server/lib/api";
import { listCampaignMessages } from "@/server/services/campaign.service";
import { listMessagesQuerySchema } from "@/shared/campaign";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

/** ?status=pending&search=gmail&page=1&limit=20 */
export const GET = withAuth<{ id: string }>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const query = listMessagesQuerySchema.parse(searchParams(request));
  return okPage(await listCampaignMessages(id, query));
});
