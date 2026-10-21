import { ok, readOptionalJson, withAuth } from "@/server/lib/api";
import { pauseInbox } from "@/server/services/inbox.service";
import { idParamsSchema } from "@/shared/common";
import { pauseInboxSchema } from "@/shared/inbox";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const { reason } = pauseInboxSchema.parse(await readOptionalJson(request));
  return ok(await pauseInbox(id, reason));
});
