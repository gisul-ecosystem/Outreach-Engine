import { ok, readJson, withAuth } from "@/server/lib/api";
import { deleteInbox, getInbox, updateInbox } from "@/server/services/inbox.service";
import { idParamsSchema } from "@/shared/common";
import { updateInboxSchema } from "@/shared/inbox";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getInbox(id));
});

export const PATCH = withAuth<Params>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = updateInboxSchema.parse(await readJson(request));
  return ok(await updateInbox(id, input));
});

export const DELETE = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await deleteInbox(id));
});
