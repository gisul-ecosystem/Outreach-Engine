import { ok, withAuth } from "@/server/lib/api";
import { getDashboardSummary } from "@/server/services/dashboard.service";

export const runtime = "nodejs";
// Live numbers: always computed on request, never prerendered.
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => ok(await getDashboardSummary()));
