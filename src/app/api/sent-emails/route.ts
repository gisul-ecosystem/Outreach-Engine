import { okPage, searchParams, withAuth } from "@/server/lib/api";
import { listTrackedEmails } from "@/server/services/tracked-email.service";
import { listTrackedEmailsQuerySchema } from "@/shared/tracked-email";

export const runtime = "nodejs";

export const GET = withAuth(async (request) => {
  const query = listTrackedEmailsQuerySchema.parse(searchParams(request));
  return okPage(await listTrackedEmails(query));
});
