import { ok, withAuth } from "@/server/lib/api";
import { discoverMailboxes } from "@/server/services/inbox.service";
import { idParamsSchema } from "@/shared/common";
import { discoverMailboxesQuerySchema } from "@/shared/inbox";

export const runtime = "nodejs";

/** Lists the mailboxes that exist on this domain in Microsoft 365 (read-only). */
export const GET = withAuth<{ id: string }>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const query = discoverMailboxesQuerySchema.parse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  return ok(await discoverMailboxes(id, query));
});
