import { ok, okPage, readJson, searchParams, withAuth } from "@/server/lib/api";
import { createList, listLists } from "@/server/services/list.service";
import { createListSchema, listListsQuerySchema } from "@/shared/list";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listListsQuerySchema.parse(searchParams(request));
  return okPage(await listLists(query));
});

export const POST = withAuth(async (request) => {
  const input = createListSchema.parse(await readJson(request));
  return ok(await createList(input), 201);
});
