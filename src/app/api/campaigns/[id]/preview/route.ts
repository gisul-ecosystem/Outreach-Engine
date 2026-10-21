import { ok, readOptionalJson, withAuth } from "@/server/lib/api";
import { previewCampaign } from "@/server/services/campaign.service";
import { previewCampaignSchema } from "@/shared/campaign";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

/** Body (all optional): { contactId, subjectTemplate, bodyTemplate, bodyHtml }. Nothing is saved or sent. */
export const POST = withAuth<{ id: string }>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = previewCampaignSchema.parse(await readOptionalJson(request));
  return ok(await previewCampaign(id, input));
});
