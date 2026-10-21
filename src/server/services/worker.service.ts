// Worker heartbeat and the single-worker lock, both stored in the settings document (BUILD_PLAN section 6).
import { Settings } from "@/server/db/models";

/** The lock is valid for this long after each renewal; a worker that stops renewing is considered dead. */
export const WORKER_LOCK_SECONDS = 90;
/** /api/health says the worker is running when its last heartbeat is younger than this. */
export const HEARTBEAT_MAX_AGE_SECONDS = 90;

const plus = (now: Date, seconds: number) => new Date(now.getTime() + seconds * 1000);

/**
 * Takes the lock if nobody holds it, it has expired, or we already hold it. Returns false when another
 * live worker holds it (the caller must then exit). One atomic update, so two workers starting at the
 * same moment cannot both win.
 */
export async function acquireWorkerLock(lockId: string, now = new Date()): Promise<boolean> {
  // The settings document is normally created by `npm run seed`; make sure it exists so the lock works.
  if (!(await Settings.exists({}))) await Settings.create({});
  const won = await Settings.findOneAndUpdate(
    {
      $or: [
        { workerLockId: lockId },
        { workerLockId: null },
        { workerLockExpiresAt: null },
        { workerLockExpiresAt: { $lt: now } },
      ],
    },
    {
      $set: {
        workerLockId: lockId,
        workerLockExpiresAt: plus(now, WORKER_LOCK_SECONDS),
        workerHeartbeatAt: now,
      },
    },
    { returnDocument: "after" },
  );
  return won !== null;
}

/** Called at the start of every tick: extends the lock and records the heartbeat. False = lock was lost. */
export async function renewWorkerLock(lockId: string, now = new Date()): Promise<boolean> {
  const renewed = await Settings.findOneAndUpdate(
    { workerLockId: lockId },
    { $set: { workerLockExpiresAt: plus(now, WORKER_LOCK_SECONDS), workerHeartbeatAt: now } },
    { returnDocument: "after" },
  );
  return renewed !== null;
}

/** Clean shutdown: free the lock (only if it is still ours) so the next worker can start at once. */
export async function releaseWorkerLock(lockId: string): Promise<void> {
  await Settings.updateOne(
    { workerLockId: lockId },
    { $set: { workerLockId: null, workerLockExpiresAt: null, workerHeartbeatAt: null } },
  );
}

/** True when a worker has recorded a heartbeat in the last 90 seconds. */
export async function isWorkerRunning(now = new Date()): Promise<boolean> {
  const settings = await Settings.findOne().select("workerHeartbeatAt").lean();
  const beat = settings?.workerHeartbeatAt;
  return !!beat && now.getTime() - beat.getTime() < HEARTBEAT_MAX_AGE_SECONDS * 1000;
}
