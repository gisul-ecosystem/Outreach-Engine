import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ DRY_RUN: true, SENDING_ENABLED: false }));
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ ...envState, APP_TIMEZONE: "Asia/Kolkata" }),
}));

import { Campaign, Contact, Domain, Event, Inbox, Message, Suppression } from "@/server/db/models";
import { plannerTick } from "@/server/scheduler/planner";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";
import { NOW, countBy, createWorld } from "../../helpers/scheduler-world";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  envState.DRY_RUN = true;
  envState.SENDING_ENABLED = false;
});

const release = () =>
  Message.updateMany(
    { status: "scheduled" },
    { $set: { status: "pending", inboxId: null, scheduledAt: null } },
  );

describe("plannerTick", () => {
  it("schedules exactly one pending message per inbox", async () => {
    const world = await createWorld({ inboxes: 3 });
    const result = await plannerTick(NOW);
    expect(result.scheduled).toBe(3);
    expect(await countBy({ status: "scheduled" })).toBe(3);
    for (const inbox of world.inboxes) {
      expect(await countBy({ inboxId: inbox._id, status: "scheduled" })).toBe(1);
    }
  });

  it("does not schedule a second message while one is in flight (also after repeated ticks)", async () => {
    await createWorld({ inboxes: 2 });
    await plannerTick(NOW);
    await plannerTick(NOW);
    await plannerTick(NOW);
    expect(await countBy({ status: "scheduled" })).toBe(2);
    // A message already 'sending' blocks its inbox too.
    await Message.updateMany({ status: "scheduled" }, { $set: { status: "sending" } });
    await plannerTick(NOW);
    expect(await countBy({ status: { $in: ["scheduled", "sending"] } })).toBe(2);
  });

  it("the database itself refuses two in-flight messages for one inbox", async () => {
    const world = await createWorld({ inboxes: 1 });
    const [a, b] = await Message.find({ status: "pending" }).limit(2);
    const inboxId = world.inboxes[0]._id;
    await Message.updateOne({ _id: a._id }, { $set: { status: "scheduled", inboxId } });
    await expect(
      Message.updateOne({ _id: b._id }, { $set: { status: "scheduled", inboxId } }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("schedules at now when the inbox never sent, and after lastSentAt + gap otherwise", async () => {
    const world = await createWorld({ inboxes: 2, minGap: 600, maxGap: 600 });
    const lastSentAt = new Date(NOW.getTime() - 60_000); // sent 1 minute ago
    await Inbox.updateOne({ _id: world.inboxes[0]._id }, { $set: { lastSentAt } });
    await plannerTick(NOW);
    const first = await Message.findOne({ inboxId: world.inboxes[0]._id });
    const second = await Message.findOne({ inboxId: world.inboxes[1]._id });
    expect(first!.scheduledAt!.getTime()).toBe(lastSentAt.getTime() + 600_000);
    expect(second!.scheduledAt!.getTime()).toBe(NOW.getTime());
  });

  it("round robin: the inbox that sent longest ago is planned first", async () => {
    const world = await createWorld({ inboxes: 2, contacts: 1 }); // only ONE message to hand out
    await Inbox.updateOne(
      { _id: world.inboxes[0]._id },
      { $set: { lastSentAt: new Date("2026-10-20T05:50:00Z") } },
    );
    await Inbox.updateOne(
      { _id: world.inboxes[1]._id },
      { $set: { lastSentAt: new Date("2026-10-20T05:00:00Z") } },
    );
    await plannerTick(NOW);
    const message = await Message.findOne({ status: "scheduled" });
    expect(String(message!.inboxId)).toBe(String(world.inboxes[1]._id));
  });

  it("stops at the daily limit (counted from the start of today in the app timezone)", async () => {
    const world = await createWorld({ inboxes: 1, dailyLimit: 2 });
    const inboxId = world.inboxes[0]._id;
    const [a, b, c] = await Message.find().limit(3);
    // Two sent today (after 00:00 IST = 18:30Z the day before) and one sent yesterday IST.
    const sent = (id: unknown, at: string) =>
      Message.updateOne({ _id: id }, { $set: { status: "sent", inboxId, sentAt: new Date(at) } });
    await sent(a._id, "2026-10-20T04:00:00Z");
    await sent(b._id, "2026-10-19T19:00:00Z"); // 00:30 IST today
    await sent(c._id, "2026-10-19T18:00:00Z"); // 23:30 IST yesterday
    await Inbox.updateOne(
      { _id: inboxId },
      { $set: { lastSentAt: new Date("2026-10-20T04:00:00Z") } },
    );
    expect((await plannerTick(NOW)).scheduled).toBe(0);
    // With a higher limit it plans again.
    await Inbox.updateOne({ _id: inboxId }, { $set: { dailyLimit: 3 } });
    expect((await plannerTick(NOW)).scheduled).toBe(1);
  });

  it("plans nothing outside the window (too early, too late, wrong day)", async () => {
    await createWorld({ inboxes: 2 });
    expect((await plannerTick(new Date("2026-10-20T03:00:00Z"))).scheduled).toBe(0); // 08:30 IST
    expect((await plannerTick(new Date("2026-10-20T12:30:00Z"))).scheduled).toBe(0); // 18:00 IST
    expect((await plannerTick(new Date("2026-10-24T06:00:00Z"))).scheduled).toBe(0); // Saturday
    expect(await countBy({ status: "scheduled" })).toBe(0);
  });

  it("skips if the next send time would be after the window end", async () => {
    const world = await createWorld({ inboxes: 1, minGap: 1200, maxGap: 1200 });
    const now = new Date("2026-10-20T12:20:00Z"); // 17:50 IST
    await Inbox.updateOne(
      { _id: world.inboxes[0]._id },
      { $set: { lastSentAt: new Date("2026-10-20T12:19:00Z") } },
    );
    expect((await plannerTick(now)).scheduled).toBe(0);
  });

  it("skips paused / errored / deleted inboxes and paused / deleted domains", async () => {
    const world = await createWorld({ inboxes: 4 });
    await Inbox.updateOne({ _id: world.inboxes[0]._id }, { $set: { status: "paused" } });
    await Inbox.updateOne({ _id: world.inboxes[1]._id }, { $set: { status: "error" } });
    await Inbox.updateOne({ _id: world.inboxes[2]._id }, { $set: { deletedAt: new Date() } });
    expect((await plannerTick(NOW)).scheduled).toBe(1); // only inbox 3

    await release();
    await Domain.updateOne({ _id: world.domain._id }, { $set: { status: "paused" } });
    expect((await plannerTick(NOW)).scheduled).toBe(0);
    await Domain.updateOne(
      { _id: world.domain._id },
      { $set: { status: "active", deletedAt: new Date() } },
    );
    expect((await plannerTick(NOW)).scheduled).toBe(0);
  });

  it("an unverified provider connection blocks live sending but not DRY_RUN", async () => {
    await createWorld({ inboxes: 1, connectionStatus: "unchecked" });
    expect((await plannerTick(NOW)).scheduled).toBe(1); // dry run
    await release();
    envState.DRY_RUN = false;
    envState.SENDING_ENABLED = true;
    expect((await plannerTick(NOW)).scheduled).toBe(0); // live: connection not 'connected'
  });

  it("kill switch: DRY_RUN=false + SENDING_ENABLED=false plans nothing", async () => {
    await createWorld({ inboxes: 2 });
    envState.DRY_RUN = false;
    envState.SENDING_ENABLED = false;
    expect((await plannerTick(NOW)).scheduled).toBe(0);
    expect(await countBy({ status: "scheduled" })).toBe(0);
  });

  it("ignores campaigns that are not running", async () => {
    await createWorld({ campaignStatus: "paused" });
    expect((await plannerTick(NOW)).scheduled).toBe(0);
  });

  it("marks suppressed, unsubscribed, bounced and deleted contacts 'skipped' and never schedules them", async () => {
    await createWorld({ inboxes: 1, contacts: 5 });
    await Suppression.create({ email: "person0@example.com", reason: "manual" });
    await Contact.updateOne({ email: "person1@example.com" }, { $set: { status: "unsubscribed" } });
    await Contact.updateOne({ email: "person2@example.com" }, { $set: { status: "bounced" } });
    await Contact.updateOne({ email: "person3@example.com" }, { $set: { deletedAt: new Date() } });
    const result = await plannerTick(NOW);
    expect(result.skipped).toBe(4);
    expect(result.scheduled).toBe(1);
    const scheduled = await Message.findOne({ status: "scheduled" });
    expect(scheduled!.toEmail).toBe("person4@example.com");
    expect(await countBy({ status: "skipped" })).toBe(4);
    const skipped = await Message.findOne({ toEmail: "person0@example.com" });
    expect(skipped!.error!.code).toBe("SUPPRESSED");
  });

  it("marks the campaign completed when nothing pending/scheduled/sending remains, not before", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 2 });
    await plannerTick(NOW);
    expect((await Campaign.findById(world.campaign._id))!.status).toBe("running");
    await Message.updateMany({}, { $set: { status: "sent", sentAt: NOW } });
    const result = await plannerTick(NOW);
    expect(result.completed).toBe(1);
    const campaign = await Campaign.findById(world.campaign._id);
    expect(campaign!.status).toBe("completed");
    expect(campaign!.completedAt).toEqual(NOW);
    expect(await Event.countDocuments({ type: "campaign.completed" })).toBe(1);
  });

  it("completes a campaign whose messages all failed or were skipped", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 2 });
    await Message.updateMany({}, { $set: { status: "failed" } });
    await plannerTick(NOW);
    expect((await Campaign.findById(world.campaign._id))!.status).toBe("completed");
  });

  it("completes even outside the window", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    await Message.updateMany({}, { $set: { status: "sent", sentAt: NOW } });
    await plannerTick(new Date("2026-10-24T06:00:00Z")); // Saturday
    expect((await Campaign.findById(world.campaign._id))!.status).toBe("completed");
  });

  it("two inboxes never get the same message", async () => {
    await createWorld({ inboxes: 3, contacts: 3 });
    await plannerTick(NOW);
    const messages = await Message.find({ status: "scheduled" });
    expect(new Set(messages.map((m) => String(m._id))).size).toBe(3);
    expect(new Set(messages.map((m) => String(m.inboxId))).size).toBe(3);
  });
});
