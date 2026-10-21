import { ok, readJson, withAuth } from "@/server/lib/api";
import { importInboxes } from "@/server/services/inbox.service";
import { idParamsSchema } from "@/shared/common";
import { importInboxesSchema } from "@/shared/inbox";

export const runtime = "nodejs";

/** Adds the chosen mailboxes as (paused) inboxes. */
export const POST = withAuth<{ id: string }>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = importInboxesSchema.parse(await readJson(request));
  return ok(await importInboxes(id, input));
});
