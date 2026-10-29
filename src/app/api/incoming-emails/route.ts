import { okPage, searchParams, withAuth } from "@/server/lib/api";
import { listIncomingEmails } from "@/server/services/incoming-email.service";
import { listIncomingEmailsQuerySchema } from "@/shared/incoming-email";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listIncomingEmailsQuerySchema.parse(searchParams(request));
  return okPage(await listIncomingEmails(query));
});
