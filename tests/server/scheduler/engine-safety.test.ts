// Audit fixes: empty-field skip, MX skip, stop-on-error, template rotation, follow-ups, bounce/reply reader.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({ DRY_RUN: true, SENDING_ENABLED: false }));
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ ...envState, APP_TIMEZONE: "Asia/Kolkata" }),
}));
const provider = vi.hoisted(() => ({ send: vi.fn(), listReceivedEmails: vi.fn() }));
vi.mock("@/server/providers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/providers")>();
  return { ...original, getProvider: () => provider, getVerificationProvider: () => provider };
});
const mx = vi.hoisted(() => ({ ok: true }));
vi.mock("@/server/lib/mx-check", () => ({ domainAcceptsEmail: async () => mx.ok }));

import {
  Campaign,
  Contact,
  Event,
  Inbox,
  Message,
  ProviderConnection,
  Suppression,
} from "@/server/db/models";
import { ProviderError, type EmailProvider } from "@/server/providers/types";
import { mailboxTick } from "@/server/scheduler/mailbox";
import { plannerTick } from "@/server/scheduler/planner";
import { senderTick } from "@/server/scheduler/sender";
import { createCampaign, startCampaign } from "@/server/services/campaign.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";
import { NOW, WINDOW, createWorld } from "../../helpers/scheduler-world";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  envState.DRY_RUN = true;
  envState.SENDING_ENABLED = false;
  mx.ok = true;
  provider.send.mockReset();
  provider.send.mockImplementation(async (input: { messageId?: string }) => ({
    internetMessageId: input.messageId,
  }));
  provider.listReceivedEmails.mockReset();
  provider.listReceivedEmails.mockResolvedValue([]);
});

const live = () => {
  envState.DRY_RUN = false;
  envState.SENDING_ENABLED = true;
};

/** Plan + send until nothing more goes out (moving the clock past each gap). */
async function sendAll(start = NOW, rounds = 10) {
  let now = start;
  for (let i = 0; i < rounds; i++) {
    await Inbox.updateMany({}, { $set: { lastSentAt: null } });
    await plannerTick(now);
    await senderTick(now);
    now = new Date(now.getTime() + 1000);
  }
  return now;
}

describe("sender: never 'Hi ,'", () => {
  it("skips (and logs) a contact missing a field the template uses; the email is not sent", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 2 });
    await Campaign.updateOne(
      { _id: world.campaign._id },
      { $set: { subjectTemplate: "For {{company}}", bodyTemplate: "Hi {{first_name}}" } },
    );
    await Contact.updateOne({ _id: world.contacts[0]._id }, { $set: { company: "Acme" } });
    await sendAll();

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(provider.send.mock.calls[0][0]).toMatchObject({
      subject: "For Acme",
      text: "Hi Person0",
    });
    const skipped = await Message.findOne({ contactId: world.contacts[1]._id }).lean();
    expect(skipped).toMatchObject({ status: "skipped", error: { code: "MISSING_FIELDS" } });
    expect(skipped!.error!.message).toContain("{{company}}");
    expect(await Event.countDocuments({ type: "message.skipped" })).toBe(1);
  });

  it("Start marks such contacts skipped right away and assigns template versions", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 3, campaignStatus: "draft" });
    await Message.deleteMany({});
    await Contact.updateOne(
      { _id: world.contacts[0]._id },
      { $set: { company: "Acme", "custom.segment": "AI" } },
    );
    await Contact.updateOne(
      { _id: world.contacts[1]._id },
      { $set: { company: "Beta", "custom.segment": "training" } },
    );
    const campaign = await createCampaign({
      name: "Rotation",
      listId: String(world.list._id),
      inboxIds: [String(world.inboxes[0]._id)],
      subjectTemplate: "GPU for {{company}}",
      bodyTemplate: "Hi {{firstName}}",
      bodyHtml: null,
      sendWindow: WINDOW,
      templateName: "GPU",
      variantColumn: "custom.segment",
      matchValues: ["ai"],
      variants: [
        {
          name: "Labs",
          subjectTemplate: "Labs for {{company}}",
          bodyTemplate: "Hi {{firstName}}",
          bodyHtml: null,
          matchValues: ["training"],
        },
      ],
    });
    const started = await startCampaign(campaign.id);
    expect(started).toMatchObject({ pending: 2, skipped: 1 });
    const byContact = async (i: number) =>
      Message.findOne({ campaignId: campaign.id, contactId: world.contacts[i]._id }).lean();
    expect(await byContact(0)).toMatchObject({
      templateName: "GPU",
      variantIndex: 0,
      status: "pending",
    });
    expect(await byContact(1)).toMatchObject({
      templateName: "Labs",
      variantIndex: 1,
      status: "pending",
    });
    expect(await byContact(2)).toMatchObject({
      status: "skipped",
      error: { code: "MISSING_FIELDS" },
    });
  });

  it("Start refuses spam wording", async () => {
    const world = await createWorld({ inboxes: 1, campaignStatus: "draft" });
    const campaign = await createCampaign({
      name: "Spammy",
      listId: String(world.list._id),
      inboxIds: [String(world.inboxes[0]._id)],
      subjectTemplate: "FREE GPUs!!!",
      bodyTemplate: "Hi {{firstName}}",
      bodyHtml: null,
      sendWindow: WINDOW,
    });
    await expect(startCampaign(campaign.id)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_READY" });
  });
});

describe("sender: address checks (live only)", () => {
  it("skips an address whose domain has no mail server", async () => {
    await createWorld({ inboxes: 1, contacts: 1 });
    live();
    mx.ok = false;
    await sendAll(NOW, 1);
    expect(provider.send).not.toHaveBeenCalled();
    expect(await Message.findOne().lean()).toMatchObject({
      status: "skipped",
      error: { code: "NO_MX" },
    });
  });
});

describe("stop-on-error", () => {
  it("3 failed emails in a row pause the whole campaign with an alert", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 10 });
    provider.send.mockRejectedValue(new ProviderError("permanent", "HTTP_400", "rejected"));
    await sendAll(NOW, 5);

    expect(provider.send).toHaveBeenCalledTimes(3);
    const campaign = await Campaign.findById(world.campaign._id).lean();
    expect(campaign).toMatchObject({ status: "paused", consecutiveFailures: 3 });
    expect(campaign!.pauseReason).toContain("3 emails in a row failed");
    expect(await Event.countDocuments({ type: "campaign.auto_paused" })).toBe(1);
    expect(await Message.countDocuments({ status: { $in: ["scheduled", "sending"] } })).toBe(0);
  });

  it("a success resets the campaign's counter", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 3 });
    await Campaign.updateOne({ _id: world.campaign._id }, { $set: { consecutiveFailures: 2 } });
    await sendAll(NOW, 1);
    expect((await Campaign.findById(world.campaign._id).lean())!.consecutiveFailures).toBe(0);
  });
});

describe("follow-ups", () => {
  async function firstCampaignSent() {
    const world = await createWorld({ inboxes: 2, contacts: 3 });
    await sendAll(NOW, 3);
    expect(await Message.countDocuments({ status: "sent" })).toBe(3);
    // The sender stamps sentAt with the real clock; put it on the test's "today".
    await Message.updateMany({ status: "sent" }, { $set: { sentAt: NOW } });
    await Campaign.updateOne({ _id: world.campaign._id }, { $set: { status: "completed" } });
    const followUp = await createCampaign({
      name: "Follow-up",
      listId: String(world.list._id),
      inboxIds: [],
      subjectTemplate: "Re: {{originalSubject}}",
      bodyTemplate: "Just checking, {{firstName}}",
      bodyHtml: null,
      sendWindow: WINDOW,
      followUpOf: String(world.campaign._id),
      followUpAfterDays: 3,
    });
    await startCampaign(followUp.id);
    return { world, followUp };
  }

  it("only after N days, only to people who did not reply, from the same inbox, in the same thread", async () => {
    const { world, followUp } = await firstCampaignSent();
    const firsts = await Message.find({ campaignId: world.campaign._id }).lean();
    await Message.updateOne({ _id: firsts[0]._id }, { $set: { repliedAt: NOW } });
    provider.send.mockClear();

    await sendAll(new Date(NOW.getTime() + 24 * 3600_000), 3); // 1 day later: too early
    expect(provider.send).not.toHaveBeenCalled();

    // 3 days later (Friday, inside the window)
    await sendAll(new Date(NOW.getTime() + 3 * 24 * 3600_000), 4);
    expect(provider.send).toHaveBeenCalledTimes(2);
    for (const [input] of provider.send.mock.calls) {
      const first = firsts.find((m) => m.toEmail === input.to)!;
      expect(first._id).not.toEqual(firsts[0]._id); // the one who replied gets nothing
      const inbox = await Inbox.findById(first.inboxId).lean();
      expect(input.from).toBe(inbox!.email);
      expect(input.inReplyTo).toBe(first.internetMessageId);
      expect(input.subject).toBe(`Re: ${first.renderedSubject}`);
    }
    expect(await Message.countDocuments({ campaignId: followUp.id, status: "sent" })).toBe(2);
  });

  it("at most one follow-up per campaign", async () => {
    const { world } = await firstCampaignSent();
    await expect(
      createCampaign({
        name: "Second follow-up",
        listId: String(world.list._id),
        inboxIds: [],
        subjectTemplate: "s",
        bodyTemplate: "b",
        bodyHtml: null,
        sendWindow: WINDOW,
        followUpOf: String(world.campaign._id),
      }),
    ).rejects.toMatchObject({ code: "FOLLOW_UP_EXISTS" });
  });
});

describe("mailbox tick: bounces and replies", () => {
  async function oneSent() {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    await sendAll(NOW, 1);
    const message = await Message.findOne({ status: "sent" }).lean();
    expect(message?.internetMessageId).toBeTruthy();
    live();
    return { world, message: message! };
  }
  const received = (over: Record<string, unknown>) => ({
    id: "r1",
    // The sender stamps sentAt with the real clock, so the report must arrive after that.
    receivedAt: new Date(Date.now() + 60_000),
    fromEmail: "postmaster@kanonkode.onmicrosoft.com",
    fromName: "Microsoft Outlook",
    subject: "Undeliverable: Hi",
    body: "",
    uniqueBody: "",
    ...over,
  });

  it("does nothing in DRY_RUN", async () => {
    await createWorld({ inboxes: 1, contacts: 1 });
    expect(await mailboxTick(NOW)).toEqual({ inboxes: 0, bounces: 0, replies: 0, optOuts: 0 });
    expect(provider.listReceivedEmails).not.toHaveBeenCalled();
  });

  it("5.7.708 bounce: saved on the email, campaign AND inbox paused with an alert", async () => {
    const { world, message } = await oneSent();
    provider.listReceivedEmails.mockResolvedValue([
      received({
        body: `Remote Server returned '550 5.7.708 Service unavailable. Access denied, traffic not accepted from this IP.'\nOriginal message headers:\nMessage-ID: ${message.internetMessageId}`,
      }),
    ]);
    // Keep the campaign running for the test (it completed after its only email).
    await Campaign.updateOne({ _id: world.campaign._id }, { $set: { status: "running" } });

    expect((await mailboxTick(NOW)).bounces).toBe(1);
    expect((await Message.findById(message._id).lean())!.bounce).toMatchObject({ code: "5.7.708" });
    expect(await Campaign.findById(world.campaign._id).lean()).toMatchObject({ status: "paused" });
    expect(await Inbox.findById(world.inboxes[0]._id).lean()).toMatchObject({ status: "paused" });
    expect(await Event.countDocuments({ type: "campaign.auto_paused" })).toBe(1);
    // Seeing the same report again changes nothing.
    expect((await mailboxTick(NOW)).bounces).toBe(0);
  });

  it("5.1.1 (address does not exist) â†’ do-not-contact list, contact marked bounced", async () => {
    const { message } = await oneSent();
    provider.listReceivedEmails.mockResolvedValue([
      received({ body: `550 5.1.1 User unknown <${message.toEmail}>` }),
    ]);
    await mailboxTick(NOW);
    expect(await Suppression.findOne({ email: message.toEmail }).lean()).toMatchObject({
      reason: "bounced",
    });
    expect(await Contact.findById(message.contactId).lean()).toMatchObject({ status: "bounced" });
  });

  it("a reply marks the email replied; a 'no' reply adds the person to the do-not-contact list", async () => {
    const { message } = await oneSent();
    provider.listReceivedEmails.mockResolvedValue([
      received({ fromEmail: message.toEmail, subject: "Re: Hi", uniqueBody: "No thanks." }),
    ]);
    expect(await mailboxTick(NOW)).toMatchObject({ replies: 1, optOuts: 1 });
    expect((await Message.findById(message._id).lean())!.repliedAt).toBeInstanceOf(Date);
    expect(await Suppression.findOne({ email: message.toEmail }).lean()).toMatchObject({
      reason: "unsubscribed",
    });
  });

  it("ignores auto-replies and strangers", async () => {
    const { message } = await oneSent();
    provider.listReceivedEmails.mockResolvedValue([
      received({
        fromEmail: message.toEmail,
        subject: "Automatic reply: Hi",
        uniqueBody: "I am away",
      }),
      received({ fromEmail: "stranger@else.com", subject: "Hello", uniqueBody: "no" }),
    ]);
    expect(await mailboxTick(NOW)).toMatchObject({ replies: 0, bounces: 0 });
    expect(await Suppression.countDocuments()).toBe(0);
  });

  it("sent through ZeptoMail, replies in Outlook: reads with the reading connection", async () => {
    const { world, message } = await oneSent();
    const zepto = await ProviderConnection.create({ name: "Zepto", type: "zeptomail" });
    await Inbox.updateOne(
      { _id: world.inboxes[0]._id },
      { $set: { providerConnectionId: zepto._id, readingConnectionId: world.connection._id } },
    );
    provider.listReceivedEmails.mockResolvedValue([
      received({ fromEmail: message.toEmail, subject: "Re: Hi", uniqueBody: "Sounds good" }),
    ]);
    const readWith: string[] = [];
    const result = await mailboxTick(NOW, {
      provider: (connection) => {
        readWith.push(String(connection._id));
        return provider as unknown as EmailProvider;
      },
    });
    expect(readWith).toEqual([String(world.connection._id)]);
    expect(result).toMatchObject({ inboxes: 1, replies: 1, optOuts: 0 });
    expect((await Message.findById(message._id).lean())!.repliedAt).toBeInstanceOf(Date);
  });

  it("without a reading connection, the sending connection reads the mailbox", async () => {
    const { world } = await oneSent();
    const readWith: string[] = [];
    await mailboxTick(NOW, {
      provider: (connection) => {
        readWith.push(String(connection._id));
        return provider as unknown as EmailProvider;
      },
    });
    expect(readWith).toEqual([String(world.connection._id)]);
  });
});
