import { ok, readJson, withAuth } from "@/server/lib/api";
import { getOrCreateLink, listContactLinks } from "@/server/services/link.service";
import { idParamsSchema } from "@/shared/common";
import { createLinkSchema } from "@/shared/tracking";

export const runtime = "nodejs";

type Params = { id: string };

/** This contact's tracking links with their click counts. */
export const GET = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await listContactLinks(id));
});

/** Get (or create) the contact's link to a destination; `new: true` always makes a fresh one. */
export const POST = withAuth<Params>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = createLinkSchema.parse(await readJson(request));
  return ok(await getOrCreateLink(id, input));
});
