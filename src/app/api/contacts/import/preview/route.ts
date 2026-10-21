import { ok, readFormData, withAuth } from "@/server/lib/api";
import { readCsvFile } from "@/server/lib/csv-import";
import { previewImport } from "@/server/services/contact.service";

export const runtime = "nodejs";

/** multipart/form-data: file. Returns columns, first 20 rows and a suggested mapping. Saves nothing. */
export const POST = withAuth(async (request) => {
  const form = await readFormData(request);
  const csv = await readCsvFile(form.get("file"));
  return ok(previewImport(csv));
});
