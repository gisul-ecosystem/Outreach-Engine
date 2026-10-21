import { getEnv } from "@/server/config/env";
import { pingDB } from "@/server/db/connect";
import { isWorkerRunning } from "@/server/services/worker.service";

export type HealthReport = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  /** true when the worker wrote a heartbeat in the last 90 s; null when the database is down (unknown). */
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

  let workerRunning: boolean | null = null;
  if (db === "ok") {
    try {
      workerRunning = await isWorkerRunning();
    } catch {
      workerRunning = null;
    }
  }

  return {
    status: db === "ok" ? "ok" : "degraded",
    db,
    workerRunning,
    dryRun: env.DRY_RUN,
    sendingEnabled: env.SENDING_ENABLED,
    time: new Date().toISOString(),
  };
}
