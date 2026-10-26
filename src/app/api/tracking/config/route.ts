import { ok, withAuth } from "@/server/lib/api";
import { trackingConfig } from "@/server/services/link.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Link base address, whether links only work on this computer, and the "Homepage" preset. */
export const GET = withAuth(async () => ok(trackingConfig()));
