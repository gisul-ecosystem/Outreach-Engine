import { okPage, searchParams, withAuth } from "@/server/lib/api";
import { listClicks } from "@/server/services/link.service";
import { listClicksQuerySchema } from "@/shared/tracking";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listClicksQuerySchema.parse(searchParams(request));
  return okPage(await listClicks(query));
});
