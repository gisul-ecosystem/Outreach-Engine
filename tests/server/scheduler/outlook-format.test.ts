// Outlook format end to end with a fake Microsoft Graph (fetch is mocked, MSAL is mocked):
// send → Message-ID read from Sent Items → bounce matched by it → follow-up as a reply in the same thread.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Types } from "mongoose";

const envState = vi.hoisted(() => ({ DRY_RUN: false, SENDING_ENABLED: true }));
vi.mock("@/server/config/env", () => ({
  getEnv: () => ({ ...envState, APP_TIMEZONE: "Asia/Kolkata" }),
}));
vi.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: class {
    acquireTokenByClientCredential = async () => ({ accessToken: "token" });
  },
}));
const real = vi.hoisted(() => ({ provider: null as unknown }));
vi.mock("@/server/providers", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/providers")>();
  return {
    ...original,
    getProvider: () => real.provider,
    getVerificationProvider: () => real.provider,
  };
});
vi.mock("@/server/lib/mx-check", () => ({ domainAcceptsEmail: async () => true }));

import { Campaign, Message } from "@/server/db/models";
import { MicrosoftGraphProvider } from "@/server/providers/microsoft-graph.provider";
import type { SentEmail } from "@/server/providers/types";
import { mailboxTick, matchSentEmails, normalizeSubject } from "@/server/scheduler/mailbox";
import { plannerTick } from "@/server/scheduler/planner";
import { senderTick } from "@/server/scheduler/sender";
import { createCampaign, startCampaign } from "@/server/services/campaign.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";
import { NOW, WINDOW, createWorld } from "../../helpers/scheduler-world";

/** A tiny fake of the Graph endpoints the engine uses. */
type Sent = {
  id: string;
  internetMessageId: string;
  from: string;
  to: string;
  subject: string;
  at: Date;
};
const graph = {
  sent: [] as Sent[],
  replies: [] as { from: string; parentId: string; body: { message: unknown; comment: string } }[],
  inbox: [] as unknown[],
  mailRead: true,
};
const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
  const path = decodeURIComponent(url.replace("https://graph.microsoft.com/v1.0", ""));
  const mailbox = /^\/users\/([^/?]+)/.exec(path)?.[1] ?? "";
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
  const denied = () =>
    new Response(JSON.stringify({ error: { code: "ErrorAccessDenied", message: "no" } }), {
      status: 403,
    });

  if (init.method === "POST" && path.endsWith("/sendMail")) {
    const { message } = JSON.parse(String(init.body));
    const n = graph.sent.length + graph.replies.length + 1;
    graph.sent.push({
      id: `graph-${n}`,
      internetMessageId: `<ms-${n}@prod.outlook.com>`,
      from: mailbox,
      to: message.toRecipients[0].emailAddress.address,
      subject: message.subject,
      at: new Date(),
    });
    return new Response(null, { status: 202 });
  }
  const reply = /\/messages\/([^/]+)\/reply$/.exec(path);
  if (init.method === "POST" && reply) {
    if (!graph.sent.some((s) => s.id === reply[1])) return new Response(null, { status: 404 });
    graph.replies.push({ from: mailbox, parentId: reply[1], body: JSON.parse(String(init.body)) });
    return new Response(null, { status: 202 });
  }
  if (path.includes("/mailFolders/sentitems/messages")) {
    if (!graph.mailRead) return denied();
    return ok({
      value: graph.sent
        .filter((s) => s.from === mailbox)
        .map((s) => ({
          id: s.id,
          internetMessageId: s.internetMessageId,
          subject: s.subject,
          sentDateTime: s.at.toISOString(),
          toRecipients: [{ emailAddress: { address: s.to } }],
        })),
    });
  }
  if (path.includes("/mailFolders/inbox/messages")) {
    return graph.mailRead ? ok({ value: graph.inbox }) : denied();
  }
  if (path.includes("/messages?$filter=internetMessageId")) {
    if (!graph.mailRead) return denied();
    const id = /eq '([^']+)'/.exec(path)?.[1];
    return ok({
      value: graph.sent.filter((s) => s.internetMessageId === id).map((s) => ({ id: s.id })),
    });
  }
  return new Response(null, { status: 404 });
});

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  graph.sent = [];
  graph.replies = [];
  graph.inbox = [];
  graph.mailRead = true;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  real.provider = new MicrosoftGraphProvider(
    { tenantId: "t", clientId: "c", clientSecret: "s" },
    `outlook-flow:${Math.random()}`,
    { sendFormat: "outlook" },
  );
});
afterEach(() => vi.unstubAllGlobals());

async function sendAll(start = NOW, rounds = 4) {
  let now = start;
  for (let i = 0; i < rounds; i++) {
    await plannerTick(now);
    await senderTick(now);
    now = new Date(now.getTime() + 60_000);
  }
}

describe("matchSentEmails (pure)", () => {
  const at = new Date("2026-10-22T05:00:00Z");
  const item = (over: Partial<SentEmail>): SentEmail => ({
    id: "g",
    internetMessageId: "<m@x>",
    subject: "Hi Ann",
    to: ["ann@x.com"],
    sentAt: at,
    ...over,
  });
  const message = {
    _id: new Types.ObjectId(),
    toEmail: "ann@x.com",
    renderedSubject: "Hi Ann",
    sentAt: at,
  };

  it("same recipient + subject close in time; the closest wins; each Sent Items email used once", () => {
    const other = { ...message, _id: new Types.ObjectId() };
    const result = matchSentEmails(
      [message, other],
      [
        item({
          id: "far",
          internetMessageId: "<far@x>",
          sentAt: new Date(at.getTime() + 20 * 60_000),
        }),
        item({ id: "near", internetMessageId: "<near@x>", sentAt: new Date(at.getTime() + 5_000) }),
      ],
    );
    expect(result).toEqual([
      { messageId: message._id, internetMessageId: "<near@x>", providerMessageId: "near" },
      { messageId: other._id, internetMessageId: "<far@x>", providerMessageId: "far" },
    ]);
  });

  it("ignores other recipients, other subjects and emails far from our send time", () => {
    expect(
      matchSentEmails(
        [message],
        [
          item({ to: ["bob@x.com"] }),
          item({ subject: "Something else" }),
          item({ sentAt: new Date(at.getTime() + 2 * 3600_000) }),
        ],
      ),
    ).toEqual([]);
  });

  it("a reply's 'RE:' does not stop a match", () => {
    expect(normalizeSubject("RE: Fw:  Hi   Ann")).toBe("hi ann");
    expect(
      matchSentEmails([{ ...message, renderedSubject: "RE: Hi Ann" }], [item({})]),
    ).toHaveLength(1);
  });
});

describe("Outlook format in the worker", () => {
  it("sends JSON, saves sendFormat, then learns the Message-ID from Sent Items (Mail.Read)", async () => {
    await createWorld({ inboxes: 1, contacts: 1 });
    await sendAll(NOW, 1);

    expect(graph.sent).toHaveLength(1);
    const sendCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/sendMail"))!;
    expect((sendCall[1] as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
    });
    let message = await Message.findOne({ status: "sent" }).lean();
    expect(message).toMatchObject({ sendFormat: "outlook", internetMessageId: null });

    await mailboxTick(NOW);
    message = await Message.findById(message!._id).lean();
    expect(message).toMatchObject({
      internetMessageId: graph.sent[0].internetMessageId,
      providerMessageId: graph.sent[0].id,
    });
  });

  it("a bounce is matched by the Message-ID found in Sent Items", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    await sendAll(NOW, 1);
    await Campaign.updateOne({ _id: world.campaign._id }, { $set: { status: "running" } });
    graph.inbox = [
      {
        id: "ndr",
        receivedDateTime: new Date(Date.now() + 60_000).toISOString(),
        from: { emailAddress: { address: "postmaster@tryracko.in", name: "Microsoft Outlook" } },
        subject: "Undeliverable: Hi Person0",
        body: {
          content: `Remote Server returned '550 5.7.708 Access denied, traffic not accepted from this IP.'\nMessage-ID: ${graph.sent[0].internetMessageId}`,
        },
      },
    ];
    expect((await mailboxTick(NOW)).bounces).toBe(1);
    expect((await Message.findOne({ status: "sent" }).lean())!.bounce).toMatchObject({
      code: "5.7.708",
    });
  });

  it("without Mail.Read the send still succeeds; the Message-ID stays empty and nothing crashes", async () => {
    graph.mailRead = false;
    await createWorld({ inboxes: 1, contacts: 1 });
    await sendAll(NOW, 1);
    expect(graph.sent).toHaveLength(1);
    await expect(mailboxTick(NOW)).resolves.toMatchObject({ inboxes: 0 });
    expect(await Message.findOne({ status: "sent" }).lean()).toMatchObject({
      sendFormat: "outlook",
      internetMessageId: null,
    });
  });

  it("a follow-up is a Graph reply to the first email: same mailbox, same thread, subject RE: …", async () => {
    const world = await createWorld({ inboxes: 2, contacts: 2 });
    await sendAll(NOW, 2);
    expect(graph.sent).toHaveLength(2);
    await mailboxTick(NOW); // learns each first email's Message-ID + Graph id
    await Message.updateMany({ status: "sent" }, { $set: { sentAt: NOW } });
    await Campaign.updateOne({ _id: world.campaign._id }, { $set: { status: "completed" } });
    const followUp = await createCampaign({
      name: "Follow-up",
      listId: String(world.list._id),
      inboxIds: [],
      subjectTemplate: "{{originalSubject}}",
      bodyTemplate: "Hi {{firstName}},\n\nJust checking in.\n\nBest,\nSam",
      bodyHtml: null,
      sendWindow: WINDOW,
      followUpOf: String(world.campaign._id),
      followUpAfterDays: 3,
    });
    await startCampaign(followUp.id);
    await sendAll(new Date(NOW.getTime() + 3 * 24 * 3600_000), 4);

    expect(graph.sent).toHaveLength(2); // no new email: both went as replies
    expect(graph.replies).toHaveLength(2);
    for (const reply of graph.replies) {
      const first = graph.sent.find((s) => s.id === reply.parentId)!;
      expect(reply.from).toBe(first.from); // the inbox that sent the first email
      expect(reply.body.message).toEqual({
        toRecipients: [{ emailAddress: { address: first.to } }],
      });
      expect(reply.body.comment).toContain("Just checking in.");
    }
    const sent = await Message.find({ campaignId: followUp.id, status: "sent" }).lean();
    expect(sent).toHaveLength(2);
    for (const m of sent) expect(m.renderedSubject).toMatch(/^RE: Hi Person\d$/);
  });

  it("a follow-up whose first email cannot be found goes out as a new email (logged)", async () => {
    const world = await createWorld({ inboxes: 1, contacts: 1 });
    await sendAll(NOW, 1);
    graph.mailRead = false; // first email's ids never learned, and cannot be looked up
    await Message.updateMany(
      { status: "sent" },
      { $set: { sentAt: NOW, internetMessageId: "<old@x>" } },
    );
    await Campaign.updateOne({ _id: world.campaign._id }, { $set: { status: "completed" } });
    const followUp = await createCampaign({
      name: "Follow-up",
      listId: String(world.list._id),
      inboxIds: [],
      subjectTemplate: "Re: {{originalSubject}}",
      bodyTemplate: "Hi {{firstName}}, checking in.",
      bodyHtml: null,
      sendWindow: WINDOW,
      followUpOf: String(world.campaign._id),
    });
    await startCampaign(followUp.id);
    await sendAll(new Date(NOW.getTime() + 3 * 24 * 3600_000), 2);

    expect(graph.replies).toHaveLength(0);
    expect(graph.sent).toHaveLength(2);
    expect(graph.sent[1].subject).toBe("Re: Hi Person0");
    expect(await Message.findOne({ campaignId: followUp.id }).lean()).toMatchObject({
      status: "sent",
      renderedSubject: "Re: Hi Person0",
    });
  });
});
