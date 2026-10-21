import { formFields, ok, readFormData, withAuth } from "@/server/lib/api";
import { readCsvFile } from "@/server/lib/csv-import";
import { importSuppressions } from "@/server/services/suppression.service";
import { importSuppressionsFieldsSchema } from "@/shared/suppression";

export const runtime = "nodejs";

/** multipart/form-data: file (CSV with an "email" column), reason?, note? */
export const POST = withAuth(async (request) => {
  const form = await readFormData(request);
  const options = importSuppressionsFieldsSchema.parse(formFields(form));
  const csv = await readCsvFile(form.get("file"));
  return ok(await importSuppressions(csv, options));
});
