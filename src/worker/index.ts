// Worker entry point: a separate Node process (`npm run worker`), never started from inside Next.js.
// Phase 0 skeleton: loads env, connects to MongoDB, stays alive, shuts down cleanly on Ctrl+C.
// Phase 6 adds the planner, sender and recovery ticks.
import { loadEnv } from "@/server/config/load-env";
import { getEnv } from "@/server/config/env";
import { connectDB, disconnectDB } from "@/server/db/connect";
import { createLogger } from "@/server/lib/logger";

const log = createLogger("worker");
const IDLE_LOG_INTERVAL_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

let idleTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;

async function main() {
  loadEnv();
  const env = getEnv();

  log.info(`starting (DRY_RUN=${env.DRY_RUN}, SENDING_ENABLED=${env.SENDING_ENABLED})`);
  await connectDB();
  log.info("connected to MongoDB");
  log.info("running. Press Ctrl+C to stop.");

  // Keeps the process alive until the real ticks exist (Phase 6).
  idleTimer = setInterval(() => log.info("idle (no ticks yet)"), IDLE_LOG_INTERVAL_MS);
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`received ${signal}, shutting down...`);

  // If something hangs, exit anyway so the process never gets stuck.
  const forceExit = setTimeout(() => {
    log.error("shutdown took too long, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  if (idleTimer) clearInterval(idleTimer);
  try {
    await disconnectDB();
    log.info("disconnected from MongoDB. Bye.");
    process.exit(0);
  } catch (err) {
    log.error("error while disconnecting", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  log.error("failed to start", err instanceof Error ? err.message : err);
  process.exit(1);
});
