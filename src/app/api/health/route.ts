import { handleError, ok } from "@/server/lib/api";
import { getHealth } from "@/server/services/health.service";

export const runtime = "nodejs";
// Always run on request; never serve a copy prerendered at build time.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await getHealth();
    return ok(health, health.db === "ok" ? 200 : 503);
  } catch (err) {
    return handleError(err);
  }
}
