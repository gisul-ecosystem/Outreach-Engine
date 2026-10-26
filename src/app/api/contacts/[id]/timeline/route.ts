import { ok, withAuth } from "@/server/lib/api";
import { getContactTimeline } from "@/server/services/link.service";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

/** Emails sent to this person, their replies and their link clicks, newest first. */
export const GET = withAuth<{ id: string }>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getContactTimeline(id));
});
