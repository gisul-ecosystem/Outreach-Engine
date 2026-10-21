import { ok, okPage, readJson, searchParams, withAuth } from "@/server/lib/api";
import { createSuppression, listSuppressions } from "@/server/services/suppression.service";
import { createSuppressionSchema, listSuppressionsQuerySchema } from "@/shared/suppression";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listSuppressionsQuerySchema.parse(searchParams(request));
  return okPage(await listSuppressions(query));
});

export const POST = withAuth(async (request) => {
  const input = createSuppressionSchema.parse(await readJson(request));
  return ok(await createSuppression(input), 201);
});
