// The readiness endpoint's data, and Start/Resume refusing "Must fix" problems on the server
// (so the rules hold even when the browser is bypassed).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Types } from "mongoose";
import {
  Campaign,
  Contact,
  Domain,
  Event,
  Inbox,
  List,
  ProviderConnection,
  Settings,
  Suppression,
} from "@/server/db/models";
import { encrypt } from "@/server/lib/crypto";
import {
  createCampaign,
  pauseCampaign,
  resumeCampaign,
  startCampaign,
  testSendCampaign,
  updateCampaign,
} from "@/server/services/campaign.service";
import { getCampaignReadiness } from "@/server/services/readiness.service";
import { createCampaignSchema, OPT_OUT_LINE } from "@/shared/campaign";
import type { ReadinessItem } from "@/shared/readiness";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

let listId: string;
let inboxId: string;
let domainId: Types.ObjectId;
let connectionId: Types.ObjectId;

const BODY = `Hi {{firstName|there}},

I noticed your team is hiring engineers and wanted to share how we help similar companies cut their cloud bills by about a third without changing any code.

Would a short call next week be useful?

Best,
{{senderName}}
{{senderRole}}, Racko Technologies

${OPT_OUT_LINE}`;

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  await Settings.create({ timezone: "Asia/Kolkata" });
  const connection = await ProviderConnection.create({
    name: "M365",
    type: "microsoft",
    tenantId: "contoso.onmicrosoft.com",
    clientId: "00000000-0000-0000-0000-000000000000",
    clientSecretEnc: encrypt("secret"),
    status: "connected",
  });
  connectionId = connection._id;
  const domain = await Domain.create({
    name: "tryracko.in",
    dns: { spf: "pass", dkim: "pass", dmarc: "pass", mx: "pass" },
  });
  domainId = domain._id;
  inboxId = String(
    (
      await Inbox.create({
        email: "sam@tryracko.in",
        displayName: "Sam Rao",
        senderName: "Sam",
        senderRole: "Founder",
        domainId,
        providerConnectionId: connection._id,
      })
    )._id,
  );
  const list = await List.create({ name: "Leads" });
  listId = String(list._id);
  await Contact.create([
    {
      email: "ann@acme.com",
      firstName: "Ann",
      company: "Acme",
      listIds: [list._id],
      custom: { city: "Pune" },
    },
    { email: "bob@beta.io", firstName: "Bob", company: "", listIds: [list._id] },
    { email: "cy@gamma.dev", firstName: "Cy", listIds: [list._id] },
    { email: "gone@x.io", firstName: "", listIds: [list._id], status: "unsubscribed" },
  ]);
});

const draft = (overrides: Record<string, unknown> = {}) =>
  createCampaign(
    createCampaignSchema.parse({
      name: "October",
      listId,
      inboxIds: [inboxId],
      subjectTemplate: "Quick question about {{company|your team}}",
      bodyTemplate: BODY,
      ...overrides,
    }),
  );
const byCheck = (items: ReadinessItem[], check: string) => items.filter((i) => i.check === check);

describe("GET /api/campaigns/[id]/readiness data", () => {
  it("gives the browser the list's columns, empty-field counts and sending domains", async () => {
    const c = await draft();
    const r = await getCampaignReadiness(c.id);
    expect(r.context).toEqual({
      isFollowUp: false,
      customVariables: ["custom.city"],
      sendingDomains: ["tryracko.in"],
      // active contacts only: Bob has no company, Bob + Cy have no last name, Ann is the only one with a city
      emptyFields: { firstName: 0, lastName: 3, company: 2, title: 3, "custom.city": 2 },
    });
    expect(r.inboxes).toEqual([
      expect.objectContaining({
        email: "sam@tryracko.in",
        senderName: "Sam",
        senderRole: "Founder",
      }),
    ]);
    expect(r.saved.filter((i) => i.level === "error")).toEqual([]);
  });

  it("setup checks: Mail.Read unknown/missing, DNS failing, no test sent yet", async () => {
    const c = await draft();
    let r = await getCampaignReadiness(c.id);
    expect(byCheck(r.setup, "mail-read")[0]).toMatchObject({ level: "warning" });
    expect(byCheck(r.setup, "mail-read")[0].message).toMatch(/Press Verify/);
    expect(byCheck(r.setup, "test-sent")[0]).toMatchObject({
      level: "warning",
      fixes: [{ kind: "send-test" }],
    });
    expect(byCheck(r.setup, "domain-dns")[0]).toMatchObject({ level: "ok" });
    expect(byCheck(r.setup, "inbox-setup")[0]).toMatchObject({ level: "ok" });

    await ProviderConnection.updateOne(
      { _id: connectionId },
      { grantedPermissions: ["Mail.Send"] },
    );
    await Domain.updateOne({ _id: domainId }, { "dns.dkim": "fail" });
    r = await getCampaignReadiness(c.id);
    expect(byCheck(r.setup, "mail-read")[0].message).toBe(
      `Bounces and replies won't be detected: "M365" is missing the Mail.Read permission in Microsoft.`,
    );
    expect(byCheck(r.setup, "domain-dns")[0]).toMatchObject({
      level: "error",
      fixes: [{ kind: "recheck-dns", domainId: String(domainId) }],
    });

    await ProviderConnection.updateOne(
      { _id: connectionId },
      { grantedPermissions: ["Mail.Send", "Mail.Read"] },
    );
    r = await getCampaignReadiness(c.id);
    expect(byCheck(r.setup, "mail-read")[0].level).toBe("ok");
  });

  it("404 for an unknown campaign", async () => {
    await expect(getCampaignReadiness("0123456789abcdef01234567")).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("Start refuses Must-fix problems (server-side, whatever the browser did)", () => {
  it.each([
    [
      "a typo in a variable",
      { bodyTemplate: BODY.replace("{{firstName|there}}", "{{frist_name}}") },
      /Did you mean \{\{first_name\}\}/,
    ],
    [
      "a leftover placeholder",
      { bodyTemplate: BODY.replace("Would", "[Name], would") },
      /placeholder "\[Name\]"/,
    ],
    ["a fake RE: subject", { subjectTemplate: "RE: Quick question" }, /starts with "RE:"/],
    [
      "'see attached'",
      { bodyTemplate: BODY.replace("Would", "Please see attached. Would") },
      /no file is ever attached/,
    ],
    ["a link shortener", { bodyTemplate: `${BODY}\nhttps://bit.ly/x` }, /Short links like bit\.ly/],
    ["spam wording", { subjectTemplate: "FREE GPUs!!" }, /spam-trigger word/],
    [
      "an unknown custom column",
      { subjectTemplate: "In {{custom.citty}}" },
      /no contact in this list has a "citty" column/i,
    ],
  ])("%s", async (_name, overrides, message) => {
    const c = await draft(overrides);
    const err = await startCampaign(c.id).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, code: "CAMPAIGN_NOT_READY" });
    expect((err as Error).message).toMatch(message);
    expect((await Campaign.findById(c.id).lean())!.status).toBe("draft");
  });

  it("a signature variable that is empty on the inbox", async () => {
    await Inbox.updateOne({ _id: inboxId }, { senderRole: "" });
    const c = await draft();
    await expect(startCampaign(c.id)).rejects.toThrow(/sam@tryracko\.in has no role/);
  });

  it("a sending domain that fails its DNS check", async () => {
    await Domain.updateOne({ _id: domainId }, { "dns.spf": "fail" });
    const c = await draft();
    await expect(startCampaign(c.id)).rejects.toThrow(/fails its SPF check/);
  });

  it("warnings do not block: no opt-out line, no greeting, no test sent → it starts", async () => {
    const c = await draft({ bodyTemplate: "Quick note about your cloud bill.\n\nSam" });
    await expect(startCampaign(c.id)).resolves.toMatchObject({ campaign: { status: "running" } });
  });
});

describe("Resume refuses Must-fix problems added while paused", () => {
  it("blocks a paused campaign edited to contain a placeholder, allows it once fixed", async () => {
    const c = await draft();
    await startCampaign(c.id);
    await pauseCampaign(c.id);
    await updateCampaign(c.id, { bodyTemplate: BODY.replace("Would", "TODO Would") });
    await expect(resumeCampaign(c.id)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_READY" });
    await updateCampaign(c.id, { bodyTemplate: BODY });
    await expect(resumeCampaign(c.id)).resolves.toMatchObject({ status: "running" });
  });
});

describe("Send test to myself (campaign)", () => {
  it("sends the campaign's email through the normal test-send flow and remembers it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const c = await draft();
    const send = vi.fn(async () => ({ providerMessageId: "p1", format: "outlook" as const }));
    const provider = {
      send,
      verifyConnection: vi.fn(),
      verifyMailbox: vi.fn(),
      listMailboxes: vi.fn(),
      listReceivedEmails: vi.fn(),
    };
    const result = await testSendCampaign(c.id, { to: "me@tryracko.in" }, { provider });

    expect(result).toMatchObject({
      to: "me@tryracko.in",
      from: "sam@tryracko.in",
      format: "outlook",
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "sam@tryracko.in",
        to: "me@tryracko.in",
        subject: "Quick question about Acme", // filled in with the list's first contact
        text: expect.stringContaining("Hi Ann,"),
      }),
    );
    expect(await Event.countDocuments({ type: "inbox.test_sent", "refs.campaignId": c.id })).toBe(
      1,
    );
    const r = await getCampaignReadiness(c.id);
    expect(byCheck(r.setup, "test-sent")[0].level).toBe("ok");
    expect(r.testSentAt).not.toBeNull();
    vi.restoreAllMocks();
  });

  it("never sends to a suppressed address, and only from the campaign's inboxes", async () => {
    const c = await draft();
    await Suppression.create({ email: "me@tryracko.in", reason: "manual" });
    await expect(testSendCampaign(c.id, { to: "me@tryracko.in" })).rejects.toMatchObject({
      code: "SUPPRESSED",
    });
    await expect(
      testSendCampaign(c.id, { to: "ok@tryracko.in", inboxId: "0123456789abcdef01234567" }),
    ).rejects.toMatchObject({ code: "INVALID_INBOX" });
    expect((await Campaign.findById(c.id).lean())!.testSentAt).toBeNull();
  });
});
