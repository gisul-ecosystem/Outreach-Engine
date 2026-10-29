// The Inbox page: every email in an attached inbox's Inbox folder is stored once, marked as a reply,
// bounce, auto-reply or other, and listed with filters. The provider is a fake.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/config/env", () => ({
  getEnv: () => ({
    DRY_RUN: true,
    SENDING_ENABLED: false,
    APP_TIMEZONE: "Asia/Kolkata",
    MAILBOX_READING: true,
  }),
}));

import { IncomingEmail, Inbox, Message, TrackedEmail } from "@/server/db/models";
import type { EmailProvider, ReceivedEmail } from "@/server/providers";
import { sentItemsTick } from "@/server/scheduler/sent-items";
import { getIncomingEmail, listIncomingEmails } from "@/server/services/incoming-email.service";
import { listIncomingEmailsQuerySchema } from "@/shared/incoming-email";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";
import { NOW, createWorld } from "../../helpers/scheduler-world";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

let counter = 0;
function received(over: Partial<ReceivedEmail> = {}): ReceivedEmail {
  return {
    id: `in-${++counter}`,
    receivedAt: new Date(NOW.getTime() - 30 * 60_000),
    fromEmail: "someone@client.com",
    fromName: "Someone",
    subject: "Hello",
    body: "Hi there.",
    uniqueBody: "Hi there.",
    conversationId: null,
    ...over,
  };
}

/** A fake mailbox with an Inbox folder per inbox address (and an empty Sent Items). */
function fakeMailbox(inbox: Record<string, ReceivedEmail[]>) {
  const provider = {
    listSentItems: async () => ({ items: [], complete: true }),
    listReceivedEmails: async (mailbox: string, since: Date) =>
      (inbox[mailbox] ?? []).filter((e) => e.receivedAt >= since),
  } as unknown as EmailProvider;
  return () => provider;
}

/** One campaign email sent to person0 an hour before NOW. */
async function worldWithSentEmail() {
  const world = await createWorld({ inboxes: 2, contacts: 2 });
  const inbox = world.inboxes[0];
  const message = await Message.findOneAndUpdate(
    { toEmail: "person0@example.com" },
    {
      $set: {
        status: "sent",
        inboxId: inbox._id,
        sentAt: new Date(NOW.getTime() - 3600_000),
      },
    },
    { returnDocument: "after" },
  ).lean();
  return { world, inbox, message: message! };
}

describe("storing the Inbox folder", () => {
  it("stores every email once, each marked reply / bounce / auto-reply / other", async () => {
    const { world, inbox, message } = await worldWithSentEmail();
    await TrackedEmail.create({
      inboxId: inbox._id,
      inboxEmail: inbox.email,
      source: "manual",
      internetMessageId: "<hand@x>",
      conversationId: "conv-hand",
      recipients: ["friend@partner.com"],
      sentAt: new Date(NOW.getTime() - 3600_000),
    });
    const emails = [
      received({
        fromEmail: "person0@example.com",
        subject: "RE: Hi Person0",
        uniqueBody: "Yes, let's talk.",
        body: "Yes, let's talk.\n\n> Hello Person0",
      }),
      received({
        fromEmail: "friend@partner.com",
        conversationId: "conv-hand",
        subject: "RE: Lunch",
      }),
      received({
        fromEmail: "postmaster@tryracko.onmicrosoft.com",
        subject: "Undeliverable: Hi",
        body: "550 5.1.1 User unknown",
      }),
      received({
        fromEmail: "person1@example.com",
        subject: "Automatic reply: Hi",
      }),
      received({ fromEmail: "news@shop.com", subject: "Big sale" }),
      received({ fromEmail: world.inboxes[1].email, subject: "Internal" }),
    ];
    const provider = fakeMailbox({ [inbox.email]: emails });

    expect((await sentItemsTick(NOW, { provider })).incoming).toBe(6);
    const byFrom = new Map(
      (await IncomingEmail.find().lean()).map((e) => [e.fromEmail, e] as const),
    );
    expect(byFrom.get("person0@example.com")).toMatchObject({
      kind: "reply",
      inboxEmail: inbox.email,
      text: "Yes, let's talk.",
      body: "Yes, let's talk.\n\n> Hello Person0",
      messageId: message._id,
      campaignId: world.campaign._id,
      contactId: world.contacts[0]._id,
    });
    expect(byFrom.get("friend@partner.com")).toMatchObject({
      kind: "reply",
      messageId: null,
    });
    expect(byFrom.get("postmaster@tryracko.onmicrosoft.com")?.kind).toBe("bounce");
    expect(byFrom.get("person1@example.com")?.kind).toBe("auto_reply");
    expect(byFrom.get("news@shop.com")?.kind).toBe("other");
    expect(byFrom.get(world.inboxes[1].email)?.kind).toBe("other");

    // The next look sees the same emails again: nothing is stored twice.
    expect((await sentItemsTick(new Date(NOW.getTime() + 5 * 60_000), { provider })).incoming).toBe(
      0,
    );
    expect(await IncomingEmail.countDocuments()).toBe(6);
  });

  it("an inbox already read for replies still gets its first 30 days stored", async () => {
    const { inbox } = await worldWithSentEmail();
    await Inbox.updateOne(
      { _id: inbox._id },
      { $set: { repliesCheckedAt: NOW, sentItemsCheckedAt: NOW } },
    );
    const old = received({
      receivedAt: new Date(NOW.getTime() - 3 * 24 * 3600_000),
    });
    const provider = fakeMailbox({ [inbox.email]: [old] });

    expect((await sentItemsTick(new Date(NOW.getTime() + 5 * 60_000), { provider })).incoming).toBe(
      1,
    );
    expect((await Inbox.findById(inbox._id).lean())!.incomingCheckedAt).toBeInstanceOf(Date);
  });
});

describe("listing the Inbox page", () => {
  async function seed() {
    const { inbox } = await worldWithSentEmail();
    await sentItemsTick(NOW, {
      provider: fakeMailbox({
        [inbox.email]: [
          received({
            fromEmail: "person0@example.com",
            subject: "RE: Hi",
            uniqueBody: "Yes!",
          }),
          received({ fromEmail: "news@shop.com", subject: "Big sale" }),
          received({
            fromEmail: "person1@example.com",
            subject: "Automatic reply: Hi",
          }),
        ],
      }),
    });
    return inbox;
  }
  const list = (q: Record<string, string> = {}) =>
    listIncomingEmails(listIncomingEmailsQuerySchema.parse(q));

  it("lists newest first with counts per kind, and filters by kind, inbox and search", async () => {
    const inbox = await seed();
    const all = await list();
    expect(all.total).toBe(3);
    expect(all.counts).toEqual({
      all: 3,
      reply: 1,
      bounce: 0,
      auto_reply: 1,
      other: 1,
    });
    expect(all.inboxes.map((i) => i.email)).toContain(inbox.email);

    const replies = await list({ kind: "reply" });
    expect(replies.data).toHaveLength(1);
    expect(replies.data[0]).toMatchObject({
      fromEmail: "person0@example.com",
      preview: "Yes!",
      campaign: { name: "Test campaign" },
      contact: { email: "person0@example.com", name: "Person0" },
    });

    expect((await list({ search: "SALE" })).data.map((e) => e.fromEmail)).toEqual([
      "news@shop.com",
    ]);
    const otherInbox = (await Inbox.findOne({
      _id: { $ne: inbox._id },
    }).lean())!;
    expect((await list({ inboxId: String(otherInbox._id) })).total).toBe(0);
  });

  it("returns the whole email by id, 404 when unknown", async () => {
    await seed();
    const { data } = await list({ kind: "reply" });
    expect(await getIncomingEmail(data[0].id)).toMatchObject({
      text: "Yes!",
      body: "Hi there.",
    });
    await expect(getIncomingEmail("0123456789abcdef01234567")).rejects.toMatchObject({
      status: 404,
    });
  });
});
