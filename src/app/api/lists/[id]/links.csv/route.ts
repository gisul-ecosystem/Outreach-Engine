import { searchParams, withAuth } from "@/server/lib/api";
import { listLinksCsv } from "@/server/services/link.service";
import { idParamsSchema } from "@/shared/common";
import { linksCsvQuerySchema } from "@/shared/tracking";

export const runtime = "nodejs";

/** CSV download: one tracking link per contact of the list (missing links are created). */
export const GET = withAuth<{ id: string }>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const query = linksCsvQuerySchema.parse(searchParams(request));
  const { filename, csv } = await listLinksCsv(id, query);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
});
