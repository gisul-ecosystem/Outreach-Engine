import { ok, readJson, withAuth } from "@/server/lib/api";
import {
  deleteProviderConnection,
  getProviderConnection,
  updateProviderConnection,
} from "@/server/services/provider.service";
import { idParamsSchema } from "@/shared/common";
import { updateProviderSchema } from "@/shared/provider";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getProviderConnection(id));
});

export const PATCH = withAuth<Params>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = updateProviderSchema.parse(await readJson(request));
  return ok(await updateProviderConnection(id, input));
});

export const DELETE = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await deleteProviderConnection(id));
});
