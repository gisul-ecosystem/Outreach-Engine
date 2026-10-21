import { ok, withAuth } from "@/server/lib/api";
import { getDashboardActivity } from "@/server/services/dashboard.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => ok(await getDashboardActivity(20)));
