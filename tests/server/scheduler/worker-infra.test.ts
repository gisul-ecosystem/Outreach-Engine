import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Event, Message, Settings } from "@/server/db/models";
import { recoveryTick } from "@/server/scheduler/recovery";
import { startTicker } from "@/server/scheduler/ticker";
import {
  HEARTBEAT_MAX_AGE_SECONDS,
  acquireWorkerLock,
  isWorkerRunning,
  releaseWorkerLock,
  renewWorkerLock,
} from "@/server/services/worker.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";
import { NOW, createWorld } from "../../helpers/scheduler-world";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

describe("recoveryTick", () => {
  it("marks an expired 'sending' message failed with UNKNOWN_STATE and writes an event; never resends", async () => {
    const world = await createWorld({ inboxes: 3, contacts: 3 });
    const [stuck, fresh, done] = await Message.find().limit(3);
    // In-flight messages always belong to an inbox (and the database allows one per inbox).
    const [inbox1, inbox2] = world.inboxes.map((i) => i._id);
    await Message.updateOne(
      { _id: stuck._id },
      {
        $set: {
          status: "sending",
          inboxId: inbox1,
          lockedUntil: new Date(NOW.getTime() - 1000),
          attempts: 1,
        },
      },
    );
    await Message.updateOne(
      { _id: fresh._id },
      {
        $set: { status: "sending", inboxId: inbox2, lockedUntil: new Date(NOW.getTime() + 60_000) },
      },
    );
    await Message.updateOne({ _id: done._id }, { $set: { status: "sent", sentAt: NOW } });

    expect(await recoveryTick(NOW)).toEqual({ recovered: 1 });
    expect(await Message.findById(stuck._id)).toMatchObject({
      status: "failed",
      attempts: 1,
      error: { code: "UNKNOWN_STATE" },
    });
    expect((await Message.findById(fresh._id))!.status).toBe("sending"); // lock still valid
    expect((await Message.findById(done._id))!.status).toBe("sent");
    expect(await Event.countDocuments({ type: "message.unknown_state" })).toBe(1);
    // Running again changes nothing.
    expect(await recoveryTick(NOW)).toEqual({ recovered: 0 });
  });
});

describe("worker lock + heartbeat", () => {
  it("the first worker gets the lock, a second one is refused", async () => {
    expect(await acquireWorkerLock("worker-a", NOW)).toBe(true);
    expect(await acquireWorkerLock("worker-b", new Date(NOW.getTime() + 30_000))).toBe(false);
    expect(await Settings.countDocuments()).toBe(1);
    expect((await Settings.findOne())!.workerLockId).toBe("worker-a");
  });

  it("only one of many simultaneous starters wins", async () => {
    await Settings.create({});
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => acquireWorkerLock(`worker-${i}`, NOW)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("renewing extends the lock by 90 s and writes the heartbeat; a stranger cannot renew", async () => {
    await acquireWorkerLock("worker-a", NOW);
    const later = new Date(NOW.getTime() + 60_000);
    expect(await renewWorkerLock("worker-a", later)).toBe(true);
    const settings = await Settings.findOne();
    expect(settings!.workerHeartbeatAt).toEqual(later);
    expect(settings!.workerLockExpiresAt).toEqual(new Date(later.getTime() + 90_000));
    expect(await renewWorkerLock("worker-b", later)).toBe(false);
  });

  it("a dead worker's lock expires after 90 s and can be taken over", async () => {
    await acquireWorkerLock("worker-a", NOW);
    expect(await acquireWorkerLock("worker-b", new Date(NOW.getTime() + 89_000))).toBe(false);
    expect(await acquireWorkerLock("worker-b", new Date(NOW.getTime() + 91_000))).toBe(true);
    expect(await renewWorkerLock("worker-a", new Date(NOW.getTime() + 92_000))).toBe(false); // lost it
  });

  it("releasing frees the lock at once and clears the heartbeat", async () => {
    await acquireWorkerLock("worker-a", NOW);
    await releaseWorkerLock("worker-a");
    expect(await isWorkerRunning(NOW)).toBe(false);
    expect(await acquireWorkerLock("worker-b", NOW)).toBe(true);
  });

  it("another worker cannot release our lock", async () => {
    await acquireWorkerLock("worker-a", NOW);
    await releaseWorkerLock("worker-b");
    expect((await Settings.findOne())!.workerLockId).toBe("worker-a");
  });

  it("workerRunning is true only while the heartbeat is younger than 90 s", async () => {
    expect(await isWorkerRunning(NOW)).toBe(false); // no settings yet
    await acquireWorkerLock("worker-a", NOW);
    expect(
      await isWorkerRunning(new Date(NOW.getTime() + (HEARTBEAT_MAX_AGE_SECONDS - 1) * 1000)),
    ).toBe(true);
    expect(
      await isWorkerRunning(new Date(NOW.getTime() + (HEARTBEAT_MAX_AGE_SECONDS + 1) * 1000)),
    ).toBe(false);
  });
});

describe("startTicker", () => {
  it("runs immediately and repeatedly, never overlapping by default", async () => {
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const ticker = startTicker({
      name: "t",
      intervalMs: 5,
      onError: () => undefined,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        runs++;
        await new Promise((r) => setTimeout(r, 20));
        active--;
      },
    });
    await new Promise((r) => setTimeout(r, 120));
    await ticker.stop();
    expect(runs).toBeGreaterThanOrEqual(3);
    expect(maxActive).toBe(1);
  });

  it("stop() waits for the run in progress and starts no new ones", async () => {
    let finished = false;
    let runs = 0;
    const ticker = startTicker({
      name: "t",
      intervalMs: 5,
      onError: () => undefined,
      run: async () => {
        runs++;
        await new Promise((r) => setTimeout(r, 50));
        finished = true;
      },
    });
    await ticker.stop();
    expect(finished).toBe(true);
    const runsAtStop = runs;
    await new Promise((r) => setTimeout(r, 40));
    expect(runs).toBe(runsAtStop);
  });

  it("a failing run is reported and the ticker keeps going", async () => {
    const onError = vi.fn();
    let runs = 0;
    const ticker = startTicker({
      name: "boom",
      intervalMs: 5,
      onError,
      run: async () => {
        runs++;
        throw new Error("nope");
      },
    });
    await new Promise((r) => setTimeout(r, 60));
    await ticker.stop();
    expect(runs).toBeGreaterThanOrEqual(2);
    expect(onError).toHaveBeenCalledWith("boom", expect.any(Error));
  });

  it("with allowOverlap a slow run does not delay the next one", async () => {
    let active = 0;
    let maxActive = 0;
    const ticker = startTicker({
      name: "t",
      intervalMs: 10,
      allowOverlap: true,
      onError: () => undefined,
      run: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 60));
        active--;
      },
    });
    await new Promise((r) => setTimeout(r, 80));
    await ticker.stop();
    expect(maxActive).toBeGreaterThan(1);
  });
});
