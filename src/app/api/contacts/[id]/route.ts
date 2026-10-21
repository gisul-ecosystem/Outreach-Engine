import { ok, readJson, withAuth } from "@/server/lib/api";
import { deleteContact, getContact, updateContact } from "@/server/services/contact.service";
import { idParamsSchema } from "@/shared/common";
import { updateContactSchema } from "@/shared/contact";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getContact(id));
});

export const PATCH = withAuth<Params>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = updateContactSchema.parse(await readJson(request));
  return ok(await updateContact(id, input));
});

export const DELETE = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await deleteContact(id));
});
