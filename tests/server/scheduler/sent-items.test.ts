// Sent Items tracking: every email sent from an attached inbox (by hand in Outlook or by the engine) is
// stored once in trackedEmails, then counted per day / week / month. The provider is a fake.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";

// DRY_RUN=true on purpose: the tracker only reads, so it must run in dry-run mode too.
const envState = vi.hoisted(() => ({ MAILBOX_READING: true }));
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({
    DRY_RUN: true,
    SENDING_ENABLED: false,
    APP_TIMEZONE: "Asia/Kolkata",
    ...envState,
  }),
}));

import {
  Contact,
  Event,
  Inbox,
  LinkClick,
  Message,
  Suppression,
  TrackedEmail,
  TrackedLink,
} from "@/server/db/models";
import {
  ProviderError,
  type EmailProvider,
  type ReceivedEmail,
  type SentItem,
  type SentItemsPage,
} from "@/server/providers";
import {
  recipientsOf,
  SENT_ITEMS_FIRST_LOOK_MS,
  sentItemsTick,
} from "@/server/scheduler/sent-items";
import { getTrackedStats, listTrackedEmails } from "@/server/services/tracked-email.service";
import type { TrackedEmailSource } from "@/shared/enums";
import { listTrackedEmailsQuerySchema, trackedStatsQuerySchema } from "@/shared/tracked-email";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";
import { NOW, createWorld } from "../../helpers/scheduler-world";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  envState.MAILBOX_READING = true;
});

let counter = 0;
function sentItem(over: Partial<SentItem> = {}): SentItem {
  const n = ++counter;
  return {
    id: `graph-${n}`,
    internetMessageId: `<m${n}@x.prod.outlook.com>`,
    conversationId: `conv-${n}`,
    subject: "Hello",
    to: ["someone@client.com"],
    cc: [],
    bcc: [],
    sentAt: new Date(NOW.getTime() - 60 * 60_000),
    linkTokens: [],
    ...over,
  };
}

function received(over: Partial<ReceivedEmail> = {}): ReceivedEmail {
  return {
    id: `in-${++counter}`,
    receivedAt: new Date(NOW.getTime() - 30 * 60_000),
    fromEmail: "someone@client.com",
    fromName: "Someone",
    subject: "RE: Hello",
    body: "Sounds good.",
    uniqueBody: "Sounds good.",
    conversationId: null,
    ...over,
  };
}

/** A fake mailbox: Sent Items + Inbox per inbox address; records each Sent Items call's time range. */
function fakeMailbox(
  sent: Record<string, SentItem[]>,
  pageResult?: Partial<SentItemsPage>,
  inbox: Record<string, ReceivedEmail[]> = {},
) {
  const calls: { mailbox: string; since: Date; until: Date }[] = [];
  const provider = {
    listSentItems: async (mailbox: string, since: Date, until: Date) => {
      calls.push({ mailbox, since, until });
      if (mailbox in sent) {
        const items = sent[mailbox].filter((s) => s.sentAt >= since && s.sentAt <= until);
        return { items, complete: true, ...pageResult };
      }
      throw new ProviderError("auth", "MISSING_PERMISSION", "no Mail.Read");
    },
    listReceivedEmails: async (mailbox: string, since: Date) =>
      (inbox[mailbox] ?? []).filter((e) => e.receivedAt >= since),
  } as unknown as EmailProvider;
  return { calls, provider: () => provider };
}

describe("recipientsOf", () => {
  it("joins To/CC/BCC, lowercases, drops duplicates and the inbox itself", () => {
    expect(
      recipientsOf(
        { to: ["A@x.com", "sales@tryracko.in"], cc: ["a@x.com", "b@x.com"], bcc: ["c@x.com"] },
        "Sales@tryracko.in",
      ),
    ).toEqual(["a@x.com", "b@x.com", "c@x.com"]);
  });
});

describe("sentItemsTick", () => {
  it("stores an email typed by hand as 'manual', with every recipient and the matching contacts", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 2 });
    const inbox = world.inboxes[0];
    const mailbox = fakeMailbox({
      [inbox.email]: [
        sentItem({
          subject: "Lunch next week?",
          to: ["person0@example.com"],
          cc: ["stranger@else.com"],
          bcc: [inbox.email],
        }),
      ],
    });

    expect(await sentItemsTick(NOW, { provider: mailbox.provider })).toEqual({
      inboxes: 1,
      manual: 1,
      engine: 0,
      replies: 0,
      optOuts: 0,
    });
    const tracked = await TrackedEmail.findOne().lean();
    expect(tracked).toMatchObject({
      source: "manual",
      inboxEmail: inbox.email,
      subject: "Lunch next week?",
      to: ["person0@example.com"],
      cc: ["stranger@else.com"],
      recipients: ["person0@example.com", "stranger@else.com"],
      messageId: null,
    });
    expect(tracked!.contactIds.map(String)).toEqual([String(world.contacts[0]._id)]);
  });

  it("works in DRY_RUN (read-only) and never touches the send queue", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 3 });
    const before = await Message.find().lean();
    const mailbox = fakeMailbox({
      [world.inboxes[0].email]: [sentItem({ to: ["person1@example.com"] })],
    });
    await sentItemsTick(NOW, { provider: mailbox.provider });
    expect(await TrackedEmail.countDocuments()).toBe(1);
    expect(await Message.find().lean()).toEqual(before);
  });

  it("marks emails the worker sent as 'engine': by Message-ID, or by recipient + subject + time", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 3 });
    const inbox = world.inboxes[0];
    const sentAt = new Date(NOW.getTime() - 30 * 60_000);
    const [byId, byMatch] = await Message.find().sort({ toEmail: 1 }).limit(2);
    await Message.updateOne(
      { _id: byId._id },
      {
        $set: { status: "sent", inboxId: inbox._id, sentAt, internetMessageId: "<engine-1@x>" },
      },
    );
    await Message.updateOne(
      { _id: byMatch._id },
      { $set: { status: "sent", inboxId: inbox._id, sentAt, renderedSubject: "Hi Person1" } },
    );
    const mailbox = fakeMailbox({
      [inbox.email]: [
        sentItem({ internetMessageId: "<engine-1@x>", to: [byId.toEmail], sentAt }),
        sentItem({
          subject: "RE: Hi Person1",
          to: [byMatch.toEmail],
          sentAt: new Date(sentAt.getTime() + 5_000),
        }),
        sentItem({ subject: "Hi Person1", to: ["person2@example.com"], sentAt }), // other recipient → by hand
      ],
    });

    expect(await sentItemsTick(NOW, { provider: mailbox.provider })).toMatchObject({
      manual: 1,
      engine: 2,
    });
    const engine = await TrackedEmail.find({ source: "engine" }).lean();
    expect(engine.map((e) => String(e.messageId)).sort()).toEqual(
      [String(byId._id), String(byMatch._id)].sort(),
    );
  });

  it("stores each email once, and carries on from where the last look stopped", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    const inbox = world.inboxes[0];
    const items = [sentItem()];
    const mailbox = fakeMailbox({ [inbox.email]: items });

    await sentItemsTick(NOW, { provider: mailbox.provider });
    // First look: 30 days back, up to 2 minutes ago.
    expect(mailbox.calls[0].since).toEqual(new Date(NOW.getTime() - SENT_ITEMS_FIRST_LOOK_MS));
    expect(mailbox.calls[0].until).toEqual(new Date(NOW.getTime() - 2 * 60_000));
    const checked = (await Inbox.findById(inbox._id).lean())!.sentItemsCheckedAt!;
    expect(checked).toEqual(mailbox.calls[0].until);

    const later = new Date(NOW.getTime() + 5 * 60_000);
    items.push(sentItem({ sentAt: new Date(NOW.getTime() + 60_000) }));
    expect(await sentItemsTick(later, { provider: mailbox.provider })).toMatchObject({
      manual: 1,
    });
    // Next look overlaps the previous one by 10 minutes; the first email is not stored twice.
    expect(mailbox.calls[1].since).toEqual(new Date(checked.getTime() - 10 * 60_000));
    expect(await TrackedEmail.countDocuments()).toBe(2);
  });

  it("when Microsoft has more emails than one look reads, the next look starts at the last one read", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    const inbox = world.inboxes[0];
    const lastAt = new Date(NOW.getTime() - 20 * 24 * 3600_000);
    const mailbox = fakeMailbox(
      { [inbox.email]: [sentItem({ sentAt: lastAt })] },
      { complete: false },
    );

    await sentItemsTick(NOW, { provider: mailbox.provider });
    const checked = (await Inbox.findById(inbox._id).lean())!.sentItemsCheckedAt!;
    expect(new Date(checked.getTime() - 10 * 60_000)).toEqual(lastAt);
  });

  it("an inbox it cannot read (no Mail.Read) is logged once and does not stop the others", async () => {
    const world = await createWorld({ inboxes: 2, contacts: 1 });
    const [broken, fine] = world.inboxes;
    const mailbox = fakeMailbox({ [fine.email]: [sentItem()] });

    expect(await sentItemsTick(NOW, { provider: mailbox.provider })).toMatchObject({
      inboxes: 1,
      manual: 1,
    });
    await sentItemsTick(new Date(NOW.getTime() + 5 * 60_000), { provider: mailbox.provider });
    const events = await Event.find({ type: "sentitems.read_failed" }).lean();
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain(broken.email);
    expect((await Inbox.findById(broken._id).lean())!.sentItemsCheckedAt).toBeNull();
  });

  it("MAILBOX_READING=false (npm run simulate) → never calls Microsoft", async () => {
    envState.MAILBOX_READING = false;
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    const provider = vi.fn();
    expect(await sentItemsTick(NOW, { provider })).toMatchObject({ inboxes: 0 });
    expect(provider).not.toHaveBeenCalled();
    expect((await Inbox.findById(world.inboxes[0]._id).lean())!.sentItemsCheckedAt).toBeNull();
  });

  it("keeps the contacts' engagement (emailed) up to date", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    const mailbox = fakeMailbox({
      [world.inboxes[0].email]: [
        sentItem({ to: ["person0@example.com"], sentAt: new Date(NOW.getTime() - 3 * 3600_000) }),
        sentItem({ to: ["person0@example.com"] }),
      ],
    });
    await sentItemsTick(NOW, { provider: mailbox.provider });
    expect((await Contact.findById(world.contacts[0]._id).lean())!.engagement).toMatchObject({
      emailsSent: 2,
      lastEmailedAt: new Date(NOW.getTime() - 60 * 60_000),
      replyCount: 0,
    });
  });
});

describe("replies to hand-sent emails", () => {
  it("a reply in the same thread, or from a recipient, marks the email replied (once)", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 2 });
    const inbox = world.inboxes[0];
    const mailbox = fakeMailbox(
      {
        [inbox.email]: [
          sentItem({ to: ["person0@example.com"], conversationId: "thread-A" }),
          sentItem({ to: ["person1@example.com"], conversationId: "thread-B" }),
        ],
      },
      undefined,
      {
        [inbox.email]: [
          // A colleague of person0 answers in the same thread.
          received({ fromEmail: "boss@example.com", conversationId: "thread-A" }),
          // person1 answers from a new email (different thread) — matched by address.
          received({ fromEmail: "person1@example.com", conversationId: "other" }),
          // Not a reply to us.
          received({ fromEmail: "newsletter@shop.com", conversationId: "zzz" }),
          // Out-of-office and bounces are ignored.
          received({ fromEmail: "person0@example.com", subject: "Automatic reply: Hello" }),
          received({ fromEmail: "postmaster@tryracko.in", subject: "Undeliverable: Hello" }),
        ],
      },
    );

    expect(await sentItemsTick(NOW, { provider: mailbox.provider })).toMatchObject({ replies: 2 });
    const emails = await TrackedEmail.find().sort({ conversationId: 1 }).lean();
    expect(emails.map((e) => e.replyFromEmail)).toEqual([
      "boss@example.com",
      "person1@example.com",
    ]);
    expect((await Contact.findById(world.contacts[1]._id).lean())!.engagement).toMatchObject({
      replyCount: 1,
    });
    // The next look reads the same replies again (overlap): nothing is counted twice.
    expect(
      await sentItemsTick(new Date(NOW.getTime() + 5 * 60_000), { provider: mailbox.provider }),
    ).toMatchObject({ replies: 0 });
  });

  it('a "no thanks" reply → suppression list (never emailed again)', async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    const inbox = world.inboxes[0];
    const mailbox = fakeMailbox(
      { [inbox.email]: [sentItem({ to: ["person0@example.com"] })] },
      undefined,
      {
        [inbox.email]: [
          received({ fromEmail: "person0@example.com", uniqueBody: "Not interested, thanks." }),
        ],
      },
    );
    expect(await sentItemsTick(NOW, { provider: mailbox.provider })).toMatchObject({
      replies: 1,
      optOuts: 1,
    });
    expect(await Suppression.findOne({ email: "person0@example.com" }).lean()).toMatchObject({
      reason: "unsubscribed",
    });
    expect((await Contact.findById(world.contacts[0]._id).lean())!.status).toBe("unsubscribed");
  });
});

describe("tracking links in hand-sent emails", () => {
  async function linkFor(contactId: Types.ObjectId, token: string) {
    return TrackedLink.create({ token, contactId, destinationUrl: "https://racko.ai/" });
  }

  it("a token in the email is linked to the email and the link (send time noted)", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    const link = await linkFor(world.contacts[0]._id, "PriyaToken01");
    const sentAt = new Date(NOW.getTime() - 60 * 60_000);
    const mailbox = fakeMailbox({
      [world.inboxes[0].email]: [
        sentItem({
          to: ["person0@example.com"],
          sentAt,
          linkTokens: ["PriyaToken01", "NotOurs12345"],
        }),
      ],
    });
    await sentItemsTick(NOW, { provider: mailbox.provider });

    const email = await TrackedEmail.findOne().lean();
    expect(email).toMatchObject({ tokens: ["PriyaToken01"], wrongLinks: [] });
    expect(await TrackedLink.findById(link._id).lean()).toMatchObject({
      sentEmailIds: [email!._id],
      firstSentAt: sentAt,
      lastSentAt: sentAt,
    });
  });

  it("someone else's link in the email → wrong-link warning", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 2 });
    const [priya, rahul] = world.contacts;
    await linkFor(priya._id, "PriyaToken01");
    const mailbox = fakeMailbox({
      [world.inboxes[0].email]: [sentItem({ to: [rahul.email], linkTokens: ["PriyaToken01"] })],
    });
    await sentItemsTick(NOW, { provider: mailbox.provider });

    const email = await TrackedEmail.findOne().lean();
    expect(email!.wrongLinks).toEqual([{ token: "PriyaToken01", contactId: priya._id }]);
    const list = await listTrackedEmails(
      listTrackedEmailsQuerySchema.parse({ wrongLinksOnly: "true" }),
    );
    expect(list.data[0].wrongLinks).toEqual([
      { token: "PriyaToken01", ownerEmail: priya.email, ownerName: "Person0" },
    ]);
    const stats = await getTrackedStats(trackedStatsQuerySchema.parse({}), NOW);
    expect(stats.wrongLinkEmails).toBe(1);
    expect(await Event.countDocuments({ type: "tracking.wrong_link" })).toBe(1);
  });

  it("a click saved before we knew when the email was sent is judged again", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    const contact = world.contacts[0];
    const link = await linkFor(contact._id, "PriyaToken01");
    const sentAt = new Date(NOW.getTime() - 60 * 60_000);
    // A scanner opened it 5 s after sending; at that moment we did not know the send time → "click".
    await LinkClick.create({
      linkId: link._id,
      token: link.token,
      contactId: contact._id,
      at: new Date(sentAt.getTime() + 5_000),
      method: "GET",
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/141.0 Safari/537.36",
      verdict: "click",
      reasons: ["Looks like a real person."],
      reasonCodes: ["looks-human"],
      signals: {
        hasAcceptLanguage: true,
        hasSecFetch: true,
        recentSameLink: 1,
        otherContactsSameVisitor: 0,
      },
    });
    await TrackedLink.updateOne({ _id: link._id }, { $set: { clickCount: 1, realClickCount: 1 } });

    const mailbox = fakeMailbox({
      [world.inboxes[0].email]: [
        sentItem({ to: [contact.email], sentAt, linkTokens: ["PriyaToken01"] }),
      ],
    });
    await sentItemsTick(NOW, { provider: mailbox.provider });

    expect(await LinkClick.findOne().lean()).toMatchObject({
      verdict: "suspicious",
      secondsSinceSent: 5,
      reasons: ["Probably a security scanner: opened 5 seconds after sending."],
    });
    expect(await TrackedLink.findById(link._id).lean()).toMatchObject({
      clickCount: 1,
      realClickCount: 0,
    });
    expect((await Contact.findById(contact._id).lean())!.engagement).toMatchObject({
      clickCount: 1,
      realClickCount: 0,
    });
  });
});

describe("tracked email stats and list", () => {
  // NOW = Tuesday 2026-10-20 11:30 IST.
  async function seed() {
    const world = await createWorld({ inboxes: 2, contacts: 1 });
    const [a, b] = world.inboxes;
    const row = (
      inbox: typeof a,
      iso: string,
      recipients: string[],
      source: TrackedEmailSource = "manual",
      subject = "Hi",
    ) => ({
      inboxId: inbox._id,
      inboxEmail: inbox.email,
      source,
      internetMessageId: `<${new Types.ObjectId()}@x>`,
      subject,
      to: recipients,
      recipients,
      sentAt: new Date(iso),
    });
    await TrackedEmail.create([
      row(a, "2026-10-20T04:00:00Z", ["ann@x.com", "bob@x.com"]), // today
      row(b, "2026-10-20T05:00:00Z", ["ann@x.com"], "manual", "Proposal"), // today, same person again
      row(a, "2026-10-19T18:00:00Z", ["cat@x.com"]), // 23:30 IST Monday → this week, not today
      row(a, "2026-10-12T06:00:00Z", ["dan@x.com"]), // last week, this month
      row(a, "2026-09-30T06:00:00Z", ["eve@x.com"]), // last month
      row(a, "2026-10-20T03:00:00Z", ["zed@x.com"], "engine"), // engine, today
    ]);
    return { a, b };
  }

  it("counts emails and different people today / this week / this month (app timezone)", async () => {
    await seed();
    const stats = await getTrackedStats(trackedStatsQuerySchema.parse({}), NOW);
    expect(stats.timezone).toBe("Asia/Kolkata");
    expect(stats.today).toEqual({ emails: 2, people: 2 });
    expect(stats.thisWeek).toEqual({ emails: 3, people: 3 });
    expect(stats.thisMonth).toEqual({ emails: 4, people: 4 });

    const all = await getTrackedStats(trackedStatsQuerySchema.parse({ source: "all" }), NOW);
    expect(all.today).toEqual({ emails: 3, people: 3 });
  });

  it("one bucket per day / week / month, oldest first, empty ones included", async () => {
    await seed();
    const days = await getTrackedStats(
      trackedStatsQuerySchema.parse({ period: "day", count: 3 }),
      NOW,
    );
    expect(days.buckets.map((b) => [b.label, b.emails, b.people])).toEqual([
      ["Sun 18 Oct", 0, 0],
      ["Mon 19 Oct", 1, 1],
      ["Tue 20 Oct", 2, 2],
    ]);
    expect(days.buckets[2]).toMatchObject({
      from: "2026-10-19T18:30:00.000Z",
      to: "2026-10-20T18:30:00.000Z",
    });

    const weeks = await getTrackedStats(
      trackedStatsQuerySchema.parse({ period: "week", count: 2 }),
      NOW,
    );
    expect(weeks.buckets.map((b) => [b.label, b.emails])).toEqual([
      ["Week of 12 Oct", 1],
      ["Week of 19 Oct", 3],
    ]);

    const months = await getTrackedStats(
      trackedStatsQuerySchema.parse({ period: "month", count: 2 }),
      NOW,
    );
    expect(months.buckets.map((b) => [b.label, b.emails, b.people])).toEqual([
      ["Sep 2026", 1, 1],
      ["Oct 2026", 4, 4],
    ]);
  });

  it("filters by inbox, and lists the inboxes with when they were last read", async () => {
    const { b } = await seed();
    await Inbox.updateOne({ _id: b._id }, { $set: { sentItemsCheckedAt: NOW } });
    const stats = await getTrackedStats(
      trackedStatsQuerySchema.parse({ inboxId: String(b._id) }),
      NOW,
    );
    expect(stats.today).toEqual({ emails: 1, people: 1 });
    expect(stats.inboxes.find((i) => i.id === String(b._id))?.checkedAt).toBe(NOW.toISOString());
  });

  it("lists newest first, with search, a time range and the matching contacts", async () => {
    await seed();
    const contact = await Contact.findOne();
    await TrackedEmail.updateMany(
      { subject: "Proposal" },
      { $set: { contactIds: [contact!._id] } },
    );

    const page = await listTrackedEmails(listTrackedEmailsQuerySchema.parse({ limit: 2 }));
    expect(page.total).toBe(5);
    expect(page.data.map((e) => e.sentAt)).toEqual([
      "2026-10-20T05:00:00.000Z",
      "2026-10-20T04:00:00.000Z",
    ]);
    expect(page.data[0].contacts).toEqual([
      { id: String(contact!._id), email: contact!.email, name: "Person0" },
    ]);

    const search = await listTrackedEmails(listTrackedEmailsQuerySchema.parse({ search: "BOB@" }));
    expect(search.data.map((e) => e.to)).toEqual([["ann@x.com", "bob@x.com"]]);
    const bySubject = await listTrackedEmails(
      listTrackedEmailsQuerySchema.parse({ search: "propo" }),
    );
    expect(bySubject.total).toBe(1);

    const monday = await listTrackedEmails(
      listTrackedEmailsQuerySchema.parse({
        from: "2026-10-18T18:30:00.000Z",
        to: "2026-10-19T18:30:00.000Z",
      }),
    );
    expect(monday.data.map((e) => e.to)).toEqual([["cat@x.com"]]);

    const engine = await listTrackedEmails(
      listTrackedEmailsQuerySchema.parse({ source: "engine" }),
    );
    expect(engine.data.map((e) => e.source)).toEqual(["engine"]);
  });
});
