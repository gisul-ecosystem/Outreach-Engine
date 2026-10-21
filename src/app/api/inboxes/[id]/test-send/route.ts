import { ok, readJson, withAuth } from "@/server/lib/api";
import { testSendFromInbox } from "@/server/services/inbox.service";
import { idParamsSchema } from "@/shared/common";
import { testSendSchema } from "@/shared/inbox";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(async (request, { params }) => {
  const { id } = idParamsSchema.parse(params);
  const { to } = testSendSchema.parse(await readJson(request));
  return ok(await testSendFromInbox(id, to));
});
