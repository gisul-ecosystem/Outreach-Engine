import { formFields, ok, readFormData, withAuth } from "@/server/lib/api";
import { readCsvFile } from "@/server/lib/csv-import";
import { importWithLinks } from "@/server/services/link.service";
import { importConfirmFieldsSchema } from "@/shared/contact";
import { importLinkFieldsSchema } from "@/shared/tracking";

export const runtime = "nodejs";

/**
 * multipart/form-data: file, mapping (JSON: column → field), listId, and optionally
 * linkDestinationUrl (+ linkDomainId) to make a tracking link for every contact of the list.
 * Imports and returns the report.
 */
export const POST = withAuth(async (request) => {
  const form = await readFormData(request);
  const fields = formFields(form);
  const { listId, mapping } = importConfirmFieldsSchema.parse(fields);
  const { linkDestinationUrl, linkDomainId } = importLinkFieldsSchema.parse(fields);
  const csv = await readCsvFile(form.get("file"));
  const links = linkDestinationUrl
    ? { destinationUrl: linkDestinationUrl, domainId: linkDomainId }
    : undefined;
  return ok(await importWithLinks(csv, mapping, listId, links));
});
