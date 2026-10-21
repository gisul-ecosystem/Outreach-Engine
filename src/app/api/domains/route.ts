import { ok, okPage, readJson, searchParams, withAuth } from "@/server/lib/api";
import { createDomain, listDomains } from "@/server/services/domain.service";
import { createDomainSchema, listDomainsQuerySchema } from "@/shared/domain";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listDomainsQuerySchema.parse(searchParams(request));
  return okPage(await listDomains(query));
});

export const POST = withAuth(async (request) => {
  const input = createDomainSchema.parse(await readJson(request));
  return ok(await createDomain(input), 201);
});
