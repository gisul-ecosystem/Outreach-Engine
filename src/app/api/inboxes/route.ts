import { ok, okPage, readJson, searchParams, withAuth } from "@/server/lib/api";
import { createInbox, listInboxes } from "@/server/services/inbox.service";
import { createInboxSchema, listInboxesQuerySchema } from "@/shared/inbox";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listInboxesQuerySchema.parse(searchParams(request));
  return okPage(await listInboxes(query));
});

export const POST = withAuth(async (request) => {
  const input = createInboxSchema.parse(await readJson(request));
  return ok(await createInbox(input), 201);
});
