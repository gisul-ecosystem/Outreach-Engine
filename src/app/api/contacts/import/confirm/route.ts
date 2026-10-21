import { formFields, ok, readFormData, withAuth } from "@/server/lib/api";
import { readCsvFile } from "@/server/lib/csv-import";
import { confirmImport } from "@/server/services/contact.service";
import { importConfirmFieldsSchema } from "@/shared/contact";

export const runtime = "nodejs";

/** multipart/form-data: file, mapping (JSON: column → field), listId. Imports and returns the report. */
export const POST = withAuth(async (request) => {
  const form = await readFormData(request);
  const { listId, mapping } = importConfirmFieldsSchema.parse(formFields(form));
  const csv = await readCsvFile(form.get("file"));
  return ok(await confirmImport(csv, mapping, listId));
});
