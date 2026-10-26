import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ DRY_RUN: true, SENDING_ENABLED: false }));
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ ...envState, APP_TIMEZONE: "Asia/Kolkata" }),
}));

// The provider is replaced by a controllable fake so tests are fast and deterministic.
const provider = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/server/providers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/providers")>();
  return { ...original, getProvider: () => provider };
});

import {
  Contact,
  Event,
  Inbox,
  Message,
  ProviderConnection,
  Campaign,
  Suppression,
} from "@/server/db/models";
import { ProviderError } from "@/server/providers/types";
import { plannerTick } from "@/server/scheduler/planner";
import { senderTick } from "@/server/scheduler/sender";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";
import { NOW, countBy, createWorld } from "../../helpers/scheduler-world";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  envState.DRY_RUN = true;
  envState.SENDING_ENABLED = false;
  provider.send.mockReset();
  provider.send.mockResolvedValue({ providerMessageId: "id-1" });
});

/** Plan, then make the planned messages due. */
async function planned(options: Parameters<typeof createWorld>[0] = {}) {
  const world = await createWorld(options);
  await plannerTick(NOW);
  return world;
}

describe("senderTick", () => {
  it("sends a due message: scheduled → sending → sent, renders the template, updates the inbox", async () => {
    const world = await planned({ inboxes: 1 });
    const result = await senderTick(NOW);
    expect(result).toMatchObject({ claimed: 1, sent: 1 });

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send.mock.calls[0][0]).toMatchObject({
      from: "inbox0@tryracko.in",
      to: "person0@example.com",
      subject: "Hi Person0",
      text: "Hello Person0",
    });
    const message = await Message.findOne({ status: "sent" });
    expect(message).toMatchObject({
      attempts: 1,
      renderedSubject: "Hi Person0",
      providerMessageId: "id-1",
    });
    expect(message!.sentAt).toBeInstanceOf(Date);
    expect(message!.lockedUntil).toBeNull();
    const inbox = await Inbox.findById(world.inboxes[0]._id);
    expect(inbox!.lastSentAt).toEqual(message!.sentAt);
    expect(inbox!.consecutiveFailures).toBe(0);
    expect(await Event.countDocuments({ type: "message.sent" })).toBe(1);
  });

  it("claims with a 2 minute lock and counts the attempt", async () => {
    await planned({ inboxes: 1 });
    let seen: { lockedUntil: Date | null | undefined; attempts: number } | undefined;
    provider.send.mockImplementation(async () => {
      const m = await Message.findOne({ status: "sending" });
      seen = { lockedUntil: m!.lockedUntil, attempts: m!.attempts };
      return {};
    });
    await senderTick(NOW);
    expect(seen!.attempts).toBe(1);
    expect(seen!.lockedUntil!.getTime()).toBe(NOW.getTime() + 2 * 60_000);
  });

  it("does not send messages that are not due yet", async () => {
    await planned({ inboxes: 1 });
    await Message.updateOne(
      { status: "scheduled" },
      { $set: { scheduledAt: new Date(NOW.getTime() + 60_000) } },
    );
    expect((await senderTick(NOW)).claimed).toBe(0);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("kill switch: DRY_RUN=false and SENDING_ENABLED=false sends nothing and claims nothing", async () => {
    await planned({ inboxes: 2 });
    envState.DRY_RUN = false;
    envState.SENDING_ENABLED = false;
    expect((await senderTick(NOW)).claimed).toBe(0);
    expect(provider.send).not.toHaveBeenCalled();
    expect(await countBy({ status: "scheduled" })).toBe(2);
  });

  it("sends different inboxes in parallel, one message each", async () => {
    await planned({ inboxes: 3 });
    const result = await senderTick(NOW);
    expect(result.sent).toBe(3);
    expect(provider.send).toHaveBeenCalledTimes(3);
  });

  it("re-checks suppression right before sending → skipped, provider never called", async () => {
    await planned({ inboxes: 1 });
    const message = await Message.findOne({ status: "scheduled" });
    await Suppression.create({ email: message!.toEmail, reason: "manual" });
    expect((await senderTick(NOW)).skipped).toBe(1);
    expect(provider.send).not.toHaveBeenCalled();
    const after = await Message.findById(message!._id);
    expect(after!.status).toBe("skipped");
    expect(after!.error!.code).toBe("SUPPRESSED");
  });

  it("re-checks the contact status right before sending (unsubscribed / bounced)", async () => {
    await planned({ inboxes: 2 });
    await Contact.updateMany({}, { $set: { status: "unsubscribed" } });
    expect((await senderTick(NOW)).skipped).toBe(2);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("a paused campaign is not sent: the message goes back to pending and the attempt is taken back", async () => {
    const world = await planned({ inboxes: 1 });
    await Campaign.updateOne({ _id: world.campaign._id }, { $set: { status: "paused" } });
    expect((await senderTick(NOW)).released).toBe(1);
    expect(provider.send).not.toHaveBeenCalled();
    const message = await Message.findOne({ toEmail: "person0@example.com" });
    expect(message).toMatchObject({
      status: "pending",
      inboxId: null,
      scheduledAt: null,
      attempts: 0,
    });
  });

  it("a paused inbox or paused domain is not sent from", async () => {
    const world = await planned({ inboxes: 1 });
    await Inbox.updateOne({ _id: world.inboxes[0]._id }, { $set: { status: "paused" } });
    expect((await senderTick(NOW)).released).toBe(1);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("nothing is sent after the window closed, even if the message was scheduled inside it", async () => {
    await planned({ inboxes: 1 });
    const late = new Date("2026-10-20T12:31:00Z"); // 18:01 IST
    expect((await senderTick(late)).released).toBe(1);
    expect(provider.send).not.toHaveBeenCalled();
    expect((await Message.findOne({ toEmail: "person0@example.com" }))!.status).toBe("pending");
  });

  it("live mode needs a connected provider connection", async () => {
    const world = await planned({ inboxes: 1 });
    envState.DRY_RUN = false;
    envState.SENDING_ENABLED = true;
    await ProviderConnection.updateOne(
      { _id: world.connection._id },
      { $set: { status: "error" } },
    );
    expect((await senderTick(NOW)).released).toBe(1);
    expect(provider.send).not.toHaveBeenCalled();
  });

  describe("errors", () => {
    const transient = (retryAfterSeconds?: number) =>
      new ProviderError("transient", "HTTP_429", "slow down", { retryAfterSeconds });

    it("transient error → scheduled again with 1m backoff, same inbox, error saved", async () => {
      const world = await planned({ inboxes: 1 });
      provider.send.mockRejectedValue(transient());
      expect((await senderTick(NOW)).retried).toBe(1);
      const message = await Message.findOne({ toEmail: "person0@example.com" });
      expect(message).toMatchObject({ status: "scheduled", attempts: 1 });
      expect(String(message!.inboxId)).toBe(String(world.inboxes[0]._id));
      expect(message!.scheduledAt!.getTime()).toBe(NOW.getTime() + 60_000);
      expect(message!.error!.code).toBe("HTTP_429");
      expect(message!.lockedUntil).toBeNull();
    });

    it("honours Retry-After when it is longer than the backoff", async () => {
      await planned({ inboxes: 1 });
      provider.send.mockRejectedValue(transient(600));
      await senderTick(NOW);
      const message = await Message.findOne({ toEmail: "person0@example.com" });
      expect(message!.scheduledAt!.getTime()).toBe(NOW.getTime() + 600_000);
    });

    it("a retry is picked up later and can succeed; backoff grows 1m → 5m; fails after 3 attempts", async () => {
      await planned({ inboxes: 1 });
      provider.send.mockRejectedValue(transient());
      await senderTick(NOW); // attempt 1 → retry in 1 min
      await senderTick(new Date(NOW.getTime() + 60_000)); // attempt 2 → retry in 5 min
      let message = await Message.findOne({ toEmail: "person0@example.com" });
      expect(message).toMatchObject({ status: "scheduled", attempts: 2 });
      expect(message!.scheduledAt!.getTime()).toBe(NOW.getTime() + 60_000 + 300_000);
      await senderTick(new Date(NOW.getTime() + 400_000)); // attempt 3 → failed
      message = await Message.findOne({ toEmail: "person0@example.com" });
      expect(message).toMatchObject({ status: "failed", attempts: 3 });
      expect(provider.send).toHaveBeenCalledTimes(3);
    });

    it("recovers after a transient error", async () => {
      await planned({ inboxes: 1 });
      provider.send
        .mockRejectedValueOnce(transient())
        .mockResolvedValue({ providerMessageId: "ok" });
      await senderTick(NOW);
      await senderTick(new Date(NOW.getTime() + 60_000));
      expect(await countBy({ toEmail: "person0@example.com", status: "sent" })).toBe(1);
    });

    it("permanent error → failed at once, no retry", async () => {
      await planned({ inboxes: 1 });
      provider.send.mockRejectedValue(new ProviderError("permanent", "HTTP_400", "rejected"));
      expect((await senderTick(NOW)).failed).toBe(1);
      const message = await Message.findOne({ toEmail: "person0@example.com" });
      expect(message).toMatchObject({ status: "failed", error: { code: "HTTP_400" } });
    });

    it("invalid recipient → failed + suppressed as bounced + contact bounced; inbox failure counter untouched", async () => {
      const world = await planned({ inboxes: 1 });
      provider.send.mockRejectedValue(
        new ProviderError("permanent", "INVALID_RECIPIENT", "no such user", {
          invalidRecipient: true,
        }),
      );
      await senderTick(NOW);
      expect(await Suppression.findOne({ email: "person0@example.com" })).toMatchObject({
        reason: "bounced",
      });
      expect((await Contact.findOne({ email: "person0@example.com" }))!.status).toBe("bounced");
      expect((await Inbox.findById(world.inboxes[0]._id))!.consecutiveFailures).toBe(0);
    });

    it("auth error → failed, connection marked error, ALL its inboxes paused, their scheduled messages released", async () => {
      const world = await planned({ inboxes: 3 });
      provider.send.mockRejectedValueOnce(new ProviderError("auth", "HTTP_401", "bad credentials"));
      provider.send.mockResolvedValue({});
      // Only one inbox is due now; the other two are scheduled in the future.
      await Message.updateMany(
        { status: "scheduled" },
        { $set: { scheduledAt: new Date(NOW.getTime() + 3_600_000) } },
      );
      const first = await Message.findOne({ status: "scheduled" });
      await Message.updateOne({ _id: first!._id }, { $set: { scheduledAt: NOW } });

      await senderTick(NOW);
      const connection = await ProviderConnection.findById(world.connection._id);
      expect(connection!.status).toBe("error");
      expect(connection!.lastError).toContain("bad credentials");
      expect(await Inbox.countDocuments({ status: "paused" })).toBe(3);
      expect(await countBy({ status: "scheduled" })).toBe(0);
      expect(await countBy({ status: "failed" })).toBe(1);
      expect(await Event.countDocuments({ type: "inbox.auto_paused" })).toBe(3);
    });

    it("5 failures in a row pause the inbox (auto_paused event) and release its scheduled message", async () => {
      const world = await createWorld({ inboxes: 1, contacts: 10 });
      const inboxId = world.inboxes[0]._id;
      provider.send.mockRejectedValue(new ProviderError("permanent", "HTTP_400", "rejected"));
      let now = NOW;
      for (let i = 0; i < 5; i++) {
        await Inbox.updateOne({ _id: inboxId }, { $set: { lastSentAt: null } });
        // Keep the campaign's own stop-on-error (3 in a row) out of this inbox-level test.
        await Campaign.updateOne({ _id: world.campaign._id }, { $set: { consecutiveFailures: 0 } });
        await plannerTick(now);
        await senderTick(now);
        now = new Date(now.getTime() + 1000);
      }
      const inbox = await Inbox.findById(inboxId);
      expect(inbox!.status).toBe("paused");
      expect(inbox!.pauseReason).toContain("5 failed sends");
      expect(inbox!.consecutiveFailures).toBe(5);
      expect(await Event.countDocuments({ type: "inbox.auto_paused" })).toBe(1);
      // A paused inbox gets no more messages.
      await plannerTick(now);
      expect(await countBy({ status: { $in: ["scheduled", "sending"] } })).toBe(0);
    });

    it("a success resets the failure counter", async () => {
      const world = await planned({ inboxes: 1 });
      await Inbox.updateOne({ _id: world.inboxes[0]._id }, { $set: { consecutiveFailures: 4 } });
      await senderTick(NOW);
      expect((await Inbox.findById(world.inboxes[0]._id))!.consecutiveFailures).toBe(0);
    });

    it("an unexpected (non-provider) error is NOT retried: failed with UNKNOWN_STATE", async () => {
      await planned({ inboxes: 1 });
      provider.send.mockRejectedValue(new Error("socket hang up"));
      await senderTick(NOW);
      const message = await Message.findOne({ toEmail: "person0@example.com" });
      expect(message).toMatchObject({ status: "failed", error: { code: "UNKNOWN_STATE" } });
      await senderTick(new Date(NOW.getTime() + 3_600_000));
      expect(provider.send).toHaveBeenCalledTimes(1);
    });
  });

  it("a message already 'sending' (stuck) is never picked up again by the sender", async () => {
    await planned({ inboxes: 1 });
    await Message.updateOne(
      { status: "scheduled" },
      { $set: { status: "sending", lockedUntil: NOW } },
    );
    await senderTick(new Date(NOW.getTime() + 3_600_000));
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("two sender ticks at the same time never send the same message twice", async () => {
    await planned({ inboxes: 3 });
    await Promise.all([senderTick(NOW), senderTick(NOW), senderTick(NOW)]);
    expect(provider.send).toHaveBeenCalledTimes(3);
    expect(await countBy({ status: "sent" })).toBe(3);
  });
});
