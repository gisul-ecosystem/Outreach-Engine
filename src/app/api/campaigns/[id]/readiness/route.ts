import { ok, withAuth } from "@/server/lib/api";
import { getCampaignReadiness } from "@/server/services/readiness.service";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

/**
 * "Outlook readiness" facts: what the browser needs for the live checks (custom columns, empty-field
 * counts, sending domains, inbox signatures) and the setup checks (inboxes, DNS, Mail.Read, test sent).
 */
export const GET = withAuth<{ id: string }>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getCampaignReadiness(id));
});
