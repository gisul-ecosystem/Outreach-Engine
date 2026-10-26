// Worker entry point: a separate Node process (`npm run worker`), never started from inside Next.js.
// Runs repeating ticks (BUILD_PLAN section 6): planner (30 s), sender (10 s), recovery (60 s),
// plus the mailbox tick (5 min) that finds bounce reports and replies.
// Only ONE worker may run at a time: it holds a lock in the settings document.
import { randomUUID } from "node:crypto";
import { loadEnv } from "@/server/config/load-env";
import { getEnv } from "@/server/config/env";
import { connectDB, disconnectDB } from "@/server/db/connect";
import { createLogger } from "@/server/lib/logger";
import { sendingMode } from "@/server/providers";
import { mailboxTick } from "@/server/scheduler/mailbox";
import { plannerTick } from "@/server/scheduler/planner";
import { recoveryTick } from "@/server/scheduler/recovery";
import { senderTick } from "@/server/scheduler/sender";
import { startTicker, type Ticker } from "@/server/scheduler/ticker";
import {
  acquireWorkerLock,
  releaseWorkerLock,
  renewWorkerLock,
} from "@/server/services/worker.service";

const log = createLogger("worker");

const PLANNER_INTERVAL_MS = 30_000;
const SENDER_INTERVAL_MS = 10_000;
const RECOVERY_INTERVAL_MS = 60_000;
/** Reads each sending inbox for bounce reports and replies. */
const MAILBOX_INTERVAL_MS = 5 * 60_000;
/** Finishing an in-progress send can take a moment (real Microsoft calls); after this we exit anyway. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

const lockId = randomUUID();
let tickers: Ticker[] = [];
let shuttingDown = false;
let lastMode: string | undefined;

/** Every tick starts here: renew the lock + heartbeat. If we lost the lock, another worker took over → stop. */
async function guarded(name: string, run: () => Promise<unknown>) {
  if (shuttingDown) return;
  if (!(await renewWorkerLock(lockId))) {
    log.error("lost the worker lock to another worker, stopping");
    void shutdown("lock lost", 1);
    return;
  }
  const mode = sendingMode();
  if (mode !== lastMode) {
    lastMode = mode;
    if (mode === "disabled") {
      log.warn(
        "SENDING_ENABLED=false and DRY_RUN=false: the kill switch is on, nothing will be planned or sent",
      );
    } else if (mode === "dry-run") {
      log.info("DRY_RUN=true: the FakeProvider is used, no real email is sent");
    } else {
      log.warn("LIVE mode: real emails will be sent");
    }
  }
  const result = await run();
  const busy = result && Object.values(result as Record<string, number>).some((n) => n > 0);
  if (busy) log.info(`${name} ${JSON.stringify(result)}`);
}

async function main() {
  loadEnv();
  const env = getEnv();

  log.info(`starting (DRY_RUN=${env.DRY_RUN}, SENDING_ENABLED=${env.SENDING_ENABLED})`);
  await connectDB();
  log.info("connected to MongoDB");

  if (!(await acquireWorkerLock(lockId))) {
    log.warn("another worker is already running (it holds the worker lock). Exiting.");
    await disconnectDB();
    process.exit(1);
  }
  log.info(`worker lock acquired (id ${lockId.slice(0, 8)})`);

  const onError = (name: string, err: unknown) =>
    log.error(`${name} tick failed`, err instanceof Error ? err.message : err);
  tickers = [
    startTicker({
      name: "recovery",
      intervalMs: RECOVERY_INTERVAL_MS,
      onError,
      run: () => guarded("recovery", () => recoveryTick()),
    }),
    startTicker({
      name: "planner",
      intervalMs: PLANNER_INTERVAL_MS,
      onError,
      run: () => guarded("planner", () => plannerTick()),
    }),
    startTicker({
      name: "sender",
      intervalMs: SENDER_INTERVAL_MS,
      onError,
      allowOverlap: true,
      run: () => guarded("sender", () => senderTick()),
    }),
    startTicker({
      name: "mailbox",
      intervalMs: MAILBOX_INTERVAL_MS,
      onError,
      run: () => guarded("mailbox", () => mailboxTick()),
    }),
  ];
  log.info(
    "running (planner 30 s, sender 10 s, recovery 60 s, bounce/reply check 5 min). Press Ctrl+C to stop.",
  );
}

async function shutdown(reason: string, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${reason}: shutting down, finishing sends in progress...`);

  // If something hangs, exit anyway so the process never gets stuck.
  const forceExit = setTimeout(() => {
    log.error("shutdown took too long, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    await Promise.all(tickers.map((t) => t.stop())); // no new ticks; waits for sends in progress
    if (reason !== "lock lost") await releaseWorkerLock(lockId);
    await disconnectDB();
    log.info("lock released, disconnected from MongoDB. Bye.");
    process.exit(exitCode);
  } catch (err) {
    log.error("error while shutting down", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("received SIGINT"));
process.on("SIGTERM", () => void shutdown("received SIGTERM"));
// Windows cannot deliver SIGINT/SIGTERM to a child process; `npm run simulate` starts the worker with an
// IPC channel and asks it to stop with this message instead (same graceful path).
process.on("message", (message) => {
  if (message === "shutdown") void shutdown("received shutdown message");
});

main().catch((err) => {
  log.error("failed to start", err instanceof Error ? err.message : err);
  process.exit(1);
});
