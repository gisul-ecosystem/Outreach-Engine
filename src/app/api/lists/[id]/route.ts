import { ok, readJson, withAuth } from "@/server/lib/api";
import { deleteList, getList, updateList } from "@/server/services/list.service";
import { idParamsSchema } from "@/shared/common";
import { updateListSchema } from "@/shared/list";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getList(id));
});

export const PATCH = withAuth<Params>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = updateListSchema.parse(await readJson(request));
  return ok(await updateList(id, input));
});

export const DELETE = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await deleteList(id));
});
