import { okPage, searchParams, withAuth } from "@/server/lib/api";
import { listContacts } from "@/server/services/contact.service";
import { listContactsQuerySchema } from "@/shared/contact";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listContactsQuerySchema.parse(searchParams(request));
  return okPage(await listContacts(query));
});
