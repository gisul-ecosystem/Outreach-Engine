import { ok, readJson, withAuth } from "@/server/lib/api";
import { deleteDomain, getDomain, updateDomain } from "@/server/services/domain.service";
import { idParamsSchema } from "@/shared/common";
import { updateDomainSchema } from "@/shared/domain";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getDomain(id));
});

export const PATCH = withAuth<Params>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const input = updateDomainSchema.parse(await readJson(request));
  return ok(await updateDomain(id, input));
});

export const DELETE = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await deleteDomain(id));
});
