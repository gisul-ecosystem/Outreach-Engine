import { getEnv } from "@/server/config/env";
import { pingDB } from "@/server/db/connect";

export type HealthReport = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  /** null until the worker heartbeat exists (settings model, Phase 1 / worker, Phase 6). */
  workerRunning: boolean | null;
  dryRun: boolean;
  sendingEnabled: boolean;
  time: string;
};

export async function getHealth(): Promise<HealthReport> {
  const env = getEnv();

  let db: HealthReport["db"] = "ok";
  try {
    await pingDB();
  } catch (err) {
    db = "error";
    console.error("[health] database ping failed:", err instanceof Error ? err.message : err);
  }

  return {
    status: db === "ok" ? "ok" : "degraded",
    db,
    workerRunning: null,
    dryRun: env.DRY_RUN,
    sendingEnabled: env.SENDING_ENABLED,
    time: new Date().toISOString(),
  };
}
