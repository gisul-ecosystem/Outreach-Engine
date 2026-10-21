import { ok, okPage, readJson, searchParams, withAuth } from "@/server/lib/api";
import { createProviderConnection, listProviders } from "@/server/services/provider.service";
import { createProviderSchema, listProvidersQuerySchema } from "@/shared/provider";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listProvidersQuerySchema.parse(searchParams(request));
  return okPage(await listProviders(query));
});

export const POST = withAuth(async (request) => {
  const input = createProviderSchema.parse(await readJson(request));
  return ok(await createProviderConnection(input), 201);
});
