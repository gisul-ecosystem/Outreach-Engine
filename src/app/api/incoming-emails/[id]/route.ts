import { ok, withAuth } from "@/server/lib/api";
import { getIncomingEmail } from "@/server/services/incoming-email.service";
import { idParamsSchema } from "@/shared/common";

export const runtime = "nodejs";

type Params = { id: string };

export const GET = withAuth<Params>(async (_request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  return ok(await getIncomingEmail(id));
});
