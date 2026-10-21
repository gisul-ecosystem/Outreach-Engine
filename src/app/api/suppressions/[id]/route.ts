import { ok, withAuth } from "@/server/lib/api";
import { deleteSuppression } from "@/server/services/suppression.service";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

export const DELETE = withAuth<{ id: string }>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await deleteSuppression(id));
});
