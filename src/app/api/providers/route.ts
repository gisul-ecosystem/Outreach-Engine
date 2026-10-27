import { ok, okPage, readJson, searchParams, withAuth } from "@/server/lib/api";
import { createProviderConnection, listProviders } from "@/server/services/provider.service";
import {
  createProviderSchema,
  createZeptoProviderSchema,
  listProvidersQuerySchema,
} from "@/shared/provider";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listProvidersQuerySchema.parse(searchParams(request));
  return okPage(await listProviders(query));
});

export const POST = withAuth(async (request) => {
  const body = await readJson(request);
  // No type (or "microsoft") = Microsoft 365, as before ZeptoMail existed.
  const isZepto = (body as { type?: unknown } | null)?.type === "zeptomail";
  const input = isZepto ? createZeptoProviderSchema.parse(body) : createProviderSchema.parse(body);
  return ok(await createProviderConnection(input), 201);
});
