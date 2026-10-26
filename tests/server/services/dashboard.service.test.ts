import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Campaign, Contact, Event, Inbox, LinkClick, Message } from "@/server/db/models";
import type { ClickVerdict } from "@/shared/enums";
import {
  getDashboardActivity,
  getDashboardCampaigns,
  getDashboardClickers,
  getDashboardInboxes,
  getDashboardSummary,
  getDashboardTimeline,
} from "@/server/services/dashboard.service";
import { acquireWorkerLock } from "@/server/services/worker.service";
import { timelineQuerySchema } from "@/shared/dashboard";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";
import { NOW, createWorld } from "../../helpers/scheduler-world";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

// NOW = Tuesday 2026-10-20 11:30 IST. Today in IST starts at 2026-10-19T18:30Z; the week at Monday 18th 18:30Z (Sun).
const at = (iso: string) => new Date(iso);

async function markSent(emails: string[], inboxId: unknown, sentAt: Date) {
  await Message.updateMany(
    { toEmail: { $in: emails } },
    { $set: { status: "sent", inboxId, sentAt } },
  );
}

describe("dashboard service", () => {
  it("summary counts sent today / this week / total, queue, failed today and active inboxes", async () => {
    const world = await createWorld({ inboxes: 2, contacts: 10 });
    const inbox = world.inboxes[0]._id;
    await markSent(
      ["person0@example.com", "person1@example.com"],
      inbox,
      at("2026-10-20T04:00:00Z"),
    ); // today
    await markSent(["person2@example.com"], inbox, at("2026-10-19T18:00:00Z")); // 23:30 IST yesterday (Mon)
    await markSent(["person3@example.com"], inbox, at("2026-10-15T06:00:00Z")); // last week
    await Message.updateOne(
      { toEmail: "person4@example.com" },
      { $set: { status: "failed", updatedAt: at("2026-10-20T05:00:00Z") } },
      { timestamps: false },
    );
    await Message.updateOne(
      { toEmail: "person5@example.com" },
      { $set: { status: "failed", updatedAt: at("2026-10-18T05:00:00Z") } },
      { timestamps: false },
    );
    await Message.updateOne(
      { toEmail: "person6@example.com" },
      {
        $set: {
          status: "scheduled",
          inboxId: world.inboxes[1]._id,
          scheduledAt: at("2026-10-20T06:05:00Z"),
        },
      },
    );
    await Inbox.updateOne({ _id: world.inboxes[1]._id }, { $set: { status: "paused" } });
    await acquireWorkerLock("w", NOW);

    const s = await getDashboardSummary(NOW);
    expect(s).toMatchObject({
      sentToday: 2,
      sentThisWeek: 3, // week starts Monday 00:00 IST = Sun 18:30Z
      totalSent: 4,
      inQueue: 4, // pending 7, 8, 9 + scheduled 6
      failedToday: 1,
      activeInboxes: 1,
      workerRunning: true,
      dryRun: true,
      mode: "dry-run",
      timezone: "Asia/Kolkata",
    });
    expect(s.nextEmail).toEqual({
      to: "person6@example.com",
      fromInbox: "inbox1@tryracko.in",
      scheduledAt: "2026-10-20T06:05:00.000Z",
    });
  });

  it("nextEmail is null and workerRunning false on an empty system", async () => {
    const s = await getDashboardSummary(NOW);
    expect(s).toMatchObject({ sentToday: 0, inQueue: 0, nextEmail: null, workerRunning: false });
  });

  it("counts real tracking-link clicks this week (not bots, not last week)", async () => {
    const contactId = new Types.ObjectId();
    const click = (verdict: ClickVerdict, iso: string) => ({
      linkId: new Types.ObjectId(),
      token: "k7f2Qa9xLm_3",
      contactId,
      at: at(iso),
      method: "GET",
      verdict,
    });
    await LinkClick.create([
      click("click", "2026-10-20T04:00:00Z"), // today
      click("click", "2026-10-19T18:40:00Z"), // Monday 00:10 IST → this week
      click("suspicious", "2026-10-20T04:00:00Z"),
      click("bot", "2026-10-20T04:00:00Z"),
      click("click", "2026-10-18T18:00:00Z"), // Sunday 23:30 IST → last week
    ]);
    expect((await getDashboardSummary(NOW)).realClicksThisWeek).toBe(2);
  });

  it("clicks per person: real clicks and bot opens counted separately, most real clicks first", async () => {
    const [priya, rahul, anita] = await Contact.create([
      { email: "priya@x.com", firstName: "Priya", lastName: "S", company: "Acme" },
      { email: "rahul@x.com", firstName: "Rahul" },
      { email: "anita@x.com" },
    ]);
    const click = (contactId: Types.ObjectId, verdict: ClickVerdict, iso: string) => ({
      linkId: new Types.ObjectId(),
      token: "k7f2Qa9xLm_3",
      contactId,
      at: at(iso),
      method: "GET",
      verdict,
    });
    await LinkClick.create([
      click(priya._id, "click", "2026-10-20T04:00:00Z"),
      click(priya._id, "click", "2026-10-20T05:00:00Z"),
      click(priya._id, "bot", "2026-10-20T03:59:00Z"),
      click(rahul._id, "click", "2026-10-19T19:00:00Z"),
      click(rahul._id, "suspicious", "2026-10-19T19:00:05Z"),
      click(anita._id, "bot", "2026-10-20T01:00:00Z"), // only a scanner
      click(rahul._id, "click", "2026-10-12T06:00:00Z"), // last week
      click(rahul._id, "click", "2026-10-13T06:00:00Z"), // last week
    ]);

    const week = await getDashboardClickers("week", 10, NOW);
    expect(week.map((c) => [c.email, c.realClicks, c.botOpens])).toEqual([
      ["priya@x.com", 2, 1],
      ["rahul@x.com", 1, 1],
      ["anita@x.com", 0, 1],
    ]);
    expect(week[0]).toMatchObject({
      name: "Priya S",
      company: "Acme",
      lastRealClickAt: "2026-10-20T05:00:00.000Z",
    });
    expect(week[2].lastRealClickAt).toBeNull();

    // All time: Rahul's 2 clicks from last week count too → he is first.
    const all = await getDashboardClickers("all", 10, NOW);
    expect(all.map((c) => [c.email, c.realClicks])).toEqual([
      ["rahul@x.com", 3],
      ["priya@x.com", 2],
      ["anita@x.com", 0],
    ]);
    expect(await getDashboardClickers("all", 1, NOW)).toHaveLength(1);
  });

  it("inboxes: sent today, limit, last sent and next scheduled per inbox", async () => {
    const world = await createWorld({ inboxes: 2, contacts: 4, dailyLimit: 7 });
    const [a, b] = world.inboxes;
    await markSent(["person0@example.com"], a._id, at("2026-10-20T04:00:00Z"));
    await markSent(["person1@example.com"], a._id, at("2026-10-19T10:00:00Z")); // yesterday
    await Inbox.updateOne({ _id: a._id }, { $set: { lastSentAt: at("2026-10-20T04:00:00Z") } });
    await Message.updateOne(
      { toEmail: "person2@example.com" },
      { $set: { status: "scheduled", inboxId: b._id, scheduledAt: at("2026-10-20T06:10:00Z") } },
    );
    const rows = await getDashboardInboxes(NOW);
    expect(rows.map((r) => r.email)).toEqual(["inbox0@tryracko.in", "inbox1@tryracko.in"]);
    expect(rows[0]).toMatchObject({
      domain: "tryracko.in",
      status: "active",
      sentToday: 1,
      dailyLimit: 7,
      lastSentAt: "2026-10-20T04:00:00.000Z",
      nextScheduledAt: null,
    });
    expect(rows[1]).toMatchObject({
      sentToday: 0,
      lastSentAt: null,
      nextScheduledAt: "2026-10-20T06:10:00.000Z",
    });
  });

  it("timeline: one entry per day in the app timezone, zero days included, sent and failed", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 6 });
    const inbox = world.inboxes[0]._id;
    await markSent(["person0@example.com"], inbox, at("2026-10-20T04:00:00Z"));
    // 19 Oct 23:30 IST belongs to the 19th, not the 20th (UTC date would also be the 19th; 20 Oct 00:30 IST = 19th 19:00Z).
    await markSent(["person1@example.com"], inbox, at("2026-10-19T19:00:00Z")); // 20th 00:30 IST
    await markSent(["person2@example.com"], inbox, at("2026-10-19T18:00:00Z")); // 19th 23:30 IST
    await markSent(["person3@example.com"], inbox, at("2026-10-01T00:00:00Z")); // outside the range
    await Message.updateOne(
      { toEmail: "person4@example.com" },
      { $set: { status: "failed", updatedAt: at("2026-10-18T05:00:00Z") } },
      { timestamps: false },
    );
    const days = await getDashboardTimeline(5, NOW);
    expect(days.map((d) => d.date)).toEqual([
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
      "2026-10-19",
      "2026-10-20",
    ]);
    expect(days.map((d) => d.sent)).toEqual([0, 0, 0, 1, 2]);
    expect(days.map((d) => d.failed)).toEqual([0, 0, 1, 0, 0]);
  });

  it("timeline query: days defaults to 14 and is limited to 1..90", () => {
    expect(timelineQuerySchema.parse({}).days).toBe(14);
    expect(timelineQuerySchema.parse({ days: "30" }).days).toBe(30);
    expect(() => timelineQuerySchema.parse({ days: "0" })).toThrow();
    expect(() => timelineQuerySchema.parse({ days: "500" })).toThrow();
  });

  it("activity: newest 20 events first", async () => {
    await Event.insertMany(
      Array.from({ length: 25 }, (_, i) => ({
        type: "message.sent",
        message: `event ${i}`,
        createdAt: new Date(NOW.getTime() + i * 1000),
      })),
    );
    const events = await getDashboardActivity(20);
    expect(events).toHaveLength(20);
    expect(events[0].message).toBe("event 24");
    expect(events[19].message).toBe("event 5");
  });

  it("campaign cards: progress, status and ETA; drafts are not shown, running comes first", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 10, dailyLimit: 5 });
    await Message.updateMany(
      { toEmail: { $in: ["person0@example.com", "person1@example.com", "person2@example.com"] } },
      { $set: { status: "sent", sentAt: NOW, inboxId: world.inboxes[0]._id } },
    );
    await Message.updateOne({ toEmail: "person9@example.com" }, { $set: { status: "skipped" } });
    await Campaign.create({
      name: "Old draft",
      listId: world.list._id,
      inboxIds: [],
      status: "draft",
    });
    await Campaign.create({
      name: "Paused",
      listId: world.list._id,
      inboxIds: [],
      status: "paused",
    });
    const cards = await getDashboardCampaigns(NOW);
    expect(cards.map((c) => c.name)).toEqual(["Test campaign", "Paused"]);
    expect(cards[0]).toMatchObject({
      status: "running",
      sent: 3,
      total: 9,
      remaining: 6,
      failed: 0,
      skipped: 1,
    });
    expect(cards[0].eta).not.toBeNull();
  });
});
