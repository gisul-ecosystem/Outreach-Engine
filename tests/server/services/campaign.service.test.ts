import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Campaign,
  Contact,
  Domain,
  Inbox,
  List,
  Message,
  ProviderConnection,
  Settings,
  Suppression,
} from "@/server/db/models";
import { encrypt } from "@/server/lib/crypto";
import {
  createCampaign,
  deleteCampaign,
  getCampaign,
  getCampaignStats,
  listCampaignMessages,
  listCampaigns,
  pauseCampaign,
  previewCampaign,
  resumeCampaign,
  startCampaign,
  updateCampaign,
} from "@/server/services/campaign.service";
import { createCampaignSchema, DEFAULT_BODY_TEMPLATE, OPT_OUT_LINE } from "@/shared/campaign";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

let listId: string;
let inboxA: string;
let inboxB: string;
let domainId: Types.ObjectId;

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  await Settings.create({ timezone: "Asia/Kolkata" });
  const provider = await ProviderConnection.create({
    name: "M365",
    type: "microsoft",
    tenantId: "contoso.onmicrosoft.com",
    clientId: "00000000-0000-0000-0000-000000000000",
    clientSecretEnc: encrypt("secret"),
  });
  const domain = await Domain.create({ name: "tryracko.in" });
  domainId = domain._id;
  const common = { domainId, providerConnectionId: provider._id };
  inboxA = String((await Inbox.create({ ...common, email: "a@tryracko.in", dailyLimit: 10 }))._id);
  inboxB = String((await Inbox.create({ ...common, email: "b@tryracko.in", dailyLimit: 20 }))._id);

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
    { email: "bob@beta.io", firstName: "", company: "Beta", listIds: [list._id] },
    { email: "carol@gamma.dev", firstName: "Carol", listIds: [list._id], status: "unsubscribed" },
    { email: "dave@delta.co", firstName: "Dave", listIds: [list._id], status: "bounced" },
    { email: "erin@echo.io", firstName: "Erin", listIds: [list._id] }, // suppressed below
    { email: "gone@x.io", listIds: [list._id], deletedAt: new Date() }, // deleted: ignored
    { email: "other@list.io", listIds: [] }, // not in the list
  ]);
  await Suppression.create({ email: "erin@echo.io", reason: "manual" });
});

const draftInput = (overrides: Record<string, unknown> = {}) =>
  createCampaignSchema.parse({
    name: "October outreach",
    listId,
    inboxIds: [inboxA, inboxB],
    subjectTemplate: "Quick question, {{firstName|there}}",
    ...overrides,
  });

describe("campaign CRUD", () => {
  it("creates a draft with the default window and the opt-out line in the body", async () => {
    const c = await createCampaign(draftInput());
    expect(c).toMatchObject({
      status: "draft",
      listName: "Leads",
      inboxIds: [inboxA, inboxB],
      sendWindow: { startMinute: 600, endMinute: 1080, days: [1, 2, 3, 4, 5] },
      totalMessages: 0,
    });
    expect(c.bodyTemplate).toBe(DEFAULT_BODY_TEMPLATE);
    expect(c.bodyTemplate).toContain(OPT_OUT_LINE);
  });

  it("a draft may have an empty subject", async () => {
    const c = await createCampaign(draftInput({ subjectTemplate: "" }));
    expect(c.subjectTemplate).toBe("");
  });

  it("rejects an unknown list or inbox", async () => {
    await expect(
      createCampaign(draftInput({ listId: new Types.ObjectId().toString() })),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_LIST" });
    await expect(
      createCampaign(draftInput({ inboxIds: [new Types.ObjectId().toString()] })),
    ).rejects.toMatchObject({ status: 400, code: "INVALID_INBOX" });
  });

  it("lists with search, status filter and pagination", async () => {
    await createCampaign(draftInput({ name: "Alpha" }));
    await createCampaign(draftInput({ name: "Beta" }));
    expect((await listCampaigns({ page: 1, limit: 20 })).total).toBe(2);
    expect((await listCampaigns({ page: 1, limit: 20, search: "alp" })).data[0].name).toBe("Alpha");
    expect((await listCampaigns({ page: 1, limit: 1 })).data).toHaveLength(1);
    expect((await listCampaigns({ page: 1, limit: 20, status: "running" })).total).toBe(0);
  });

  it("only draft or paused campaigns can be edited", async () => {
    const c = await createCampaign(draftInput());
    expect((await updateCampaign(c.id, { name: "Renamed" })).name).toBe("Renamed");
    await startCampaign(c.id);
    await expect(updateCampaign(c.id, { name: "X" })).rejects.toMatchObject({
      status: 409,
      code: "CAMPAIGN_NOT_EDITABLE",
    });
    await pauseCampaign(c.id);
    expect((await updateCampaign(c.id, { subjectTemplate: "New subject" })).subjectTemplate).toBe(
      "New subject",
    );
    // the list is fixed once messages exist
    const other = await List.create({ name: "Other" });
    await expect(updateCampaign(c.id, { listId: String(other._id) })).rejects.toMatchObject({
      code: "CAMPAIGN_LIST_LOCKED",
    });
    await Campaign.updateOne({ _id: c.id }, { status: "completed" });
    await expect(updateCampaign(c.id, { name: "X" })).rejects.toMatchObject({ status: 409 });
  });

  it("soft-deletes; a running campaign must be paused first", async () => {
    const c = await createCampaign(draftInput());
    await startCampaign(c.id);
    await expect(deleteCampaign(c.id)).rejects.toMatchObject({ code: "CAMPAIGN_RUNNING" });
    await pauseCampaign(c.id);
    await deleteCampaign(c.id);
    await expect(getCampaign(c.id)).rejects.toMatchObject({ status: 404 });
    expect(await Campaign.countDocuments()).toBe(1);
    expect(await Message.countDocuments({ campaignId: c.id })).toBe(5); // history kept
  });
});

describe("previewCampaign", () => {
  it("renders for the first active contact of the list by default", async () => {
    const c = await createCampaign(
      draftInput({ bodyTemplate: "Hi {{firstName}} from {{company}} in {{custom.city}}" }),
    );
    const p = await previewCampaign(c.id, {});
    expect(p.contact?.email).toBe("ann@acme.com");
    expect(p.subject).toBe("Quick question, Ann");
    expect(p.text).toBe("Hi Ann from Acme in Pune");
    expect(p.warnings).toEqual([]);
    expect(p.customVariables).toEqual(["custom.city"]);
  });

  it("renders for a chosen contact and reports warnings", async () => {
    const c = await createCampaign(draftInput({ bodyTemplate: "Hi {{firstName}} {{nickname}}" }));
    const bob = await Contact.findOne({ email: "bob@beta.io" }).lean();
    const p = await previewCampaign(c.id, { contactId: String(bob!._id) });
    expect(p.subject).toBe("Quick question, there");
    expect(p.text).toBe("Hi  ");
    expect(p.warnings.join(" | ")).toContain("{{firstName}} is empty for bob@beta.io");
    expect(p.warnings.join(" | ")).toContain("{{nickname}} is not a known variable");
  });

  it("previews unsaved templates without saving them", async () => {
    const c = await createCampaign(draftInput());
    const p = await previewCampaign(c.id, {
      subjectTemplate: "Hello {{company}}",
      bodyTemplate: "Body",
      bodyHtml: "<p>{{company}}</p>",
    });
    expect(p.subject).toBe("Hello Acme");
    expect(p.html).toBe("<p>Acme</p>");
    expect((await getCampaign(c.id)).subjectTemplate).toBe("Quick question, {{firstName|there}}");
  });

  it("warns about an empty subject and rejects a contact outside the list", async () => {
    const c = await createCampaign(draftInput({ subjectTemplate: "" }));
    expect((await previewCampaign(c.id, {})).warnings).toContain("The subject is empty.");
    const outsider = await Contact.findOne({ email: "other@list.io" }).lean();
    await expect(previewCampaign(c.id, { contactId: String(outsider!._id) })).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("works for an empty list", async () => {
    const empty = await List.create({ name: "Empty" });
    const c = await createCampaign(draftInput({ listId: String(empty._id) }));
    const p = await previewCampaign(c.id, {});
    expect(p.contact).toBeNull();
    expect(p.warnings[0]).toContain("no contacts");
  });
});

describe("startCampaign", () => {
  it("creates one pending message per active contact, skipped for the rest", async () => {
    const c = await createCampaign(draftInput());
    const result = await startCampaign(c.id);
    expect(result).toMatchObject({ created: 5, pending: 2, skipped: 3 });
    expect(result.campaign.status).toBe("running");
    expect(result.campaign.startedAt).not.toBeNull();

    const messages = await Message.find({ campaignId: c.id }).lean();
    const byEmail = Object.fromEntries(messages.map((m) => [m.toEmail, m]));
    expect(byEmail["ann@acme.com"].status).toBe("pending");
    expect(byEmail["bob@beta.io"].status).toBe("pending");
    expect(byEmail["carol@gamma.dev"]).toMatchObject({
      status: "skipped",
      error: { code: "UNSUBSCRIBED" },
    });
    expect(byEmail["dave@delta.co"]).toMatchObject({
      status: "skipped",
      error: { code: "BOUNCED" },
    });
    expect(byEmail["erin@echo.io"]).toMatchObject({
      status: "skipped",
      error: { code: "SUPPRESSED" },
    });
    expect(byEmail["gone@x.io"]).toBeUndefined();
    expect(byEmail["other@list.io"]).toBeUndefined();
    expect(
      messages.every((m) => m.inboxId === null && m.scheduledAt === null && m.sentAt === null),
    ).toBe(true);
  });

  it("starting twice creates no duplicates (409 the second time)", async () => {
    const c = await createCampaign(draftInput());
    await startCampaign(c.id);
    await expect(startCampaign(c.id)).rejects.toMatchObject({
      status: 409,
      code: "CAMPAIGN_ALREADY_STARTED",
    });
    expect(await Message.countDocuments({ campaignId: c.id })).toBe(5);
  });

  it("two Starts at the same moment (double click) still create each message once", async () => {
    const c = await createCampaign(draftInput());
    const results = await Promise.allSettled([startCampaign(c.id), startCampaign(c.id)]);
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await Message.countDocuments({ campaignId: c.id })).toBe(5);
  });

  it("a retry after a crash half-way only adds the missing messages", async () => {
    const c = await createCampaign(draftInput());
    const ann = await Contact.findOne({ email: "ann@acme.com" }).lean();
    // As if a previous Start crashed after inserting one message (campaign still draft).
    await Message.create({ campaignId: c.id, contactId: ann!._id, toEmail: ann!.email });
    const result = await startCampaign(c.id);
    expect(result.created).toBe(4);
    expect(await Message.countDocuments({ campaignId: c.id })).toBe(5);
  });

  it("handles more than one batch (2,500 contacts)", async () => {
    const big = await List.create({ name: "Big" });
    await Contact.insertMany(
      Array.from({ length: 2500 }, (_, i) => ({ email: `p${i}@bulk.io`, listIds: [big._id] })),
    );
    await Suppression.create({ email: "p7@bulk.io", reason: "bounced" });
    const c = await createCampaign(draftInput({ listId: String(big._id) }));
    const result = await startCampaign(c.id);
    expect(result).toMatchObject({ created: 2500, pending: 2499, skipped: 1 });
  });

  it("refuses to start with something missing, and creates nothing", async () => {
    const c = await createCampaign(
      draftInput({ subjectTemplate: " ", bodyTemplate: "", inboxIds: [] }),
    );
    const err = await startCampaign(c.id).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, code: "CAMPAIGN_NOT_READY" });
    const message = (err as Error).message;
    expect(message).toContain("Write a subject");
    expect(message).toContain("Write the email body");
    expect(message).toContain("at least one active inbox");
    expect(await Message.countDocuments()).toBe(0);
    expect((await getCampaign(c.id)).status).toBe("draft");
  });

  it("needs an ACTIVE inbox on an ACTIVE domain", async () => {
    await Inbox.updateMany({}, { status: "paused" });
    const c = await createCampaign(draftInput());
    await expect(startCampaign(c.id)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_READY" });
    await Inbox.updateMany({}, { status: "active" });
    await Domain.updateOne({ _id: domainId }, { status: "paused" });
    await expect(startCampaign(c.id)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_READY" });
  });

  it("refuses a list where nobody can be emailed", async () => {
    await Contact.updateMany({}, { status: "unsubscribed" });
    const c = await createCampaign(draftInput());
    await expect(startCampaign(c.id)).rejects.toThrow(/No contact in this list can be emailed/);
  });

  it("refuses when the list was deleted", async () => {
    const c = await createCampaign(draftInput());
    await List.updateOne({ _id: listId }, { deletedAt: new Date() });
    await expect(startCampaign(c.id)).rejects.toThrow(/list was deleted/);
  });
});

describe("pause / resume", () => {
  it("running → paused → running; scheduled messages go back to pending", async () => {
    const c = await createCampaign(draftInput());
    await startCampaign(c.id);
    await Message.updateOne(
      { campaignId: c.id, status: "pending" },
      { status: "scheduled", inboxId: inboxA, scheduledAt: new Date() },
    );
    expect((await pauseCampaign(c.id)).status).toBe("paused");
    expect(await Message.countDocuments({ campaignId: c.id, status: "scheduled" })).toBe(0);
    expect((await resumeCampaign(c.id)).status).toBe("running");
  });

  it("only valid transitions are allowed", async () => {
    const c = await createCampaign(draftInput());
    await expect(pauseCampaign(c.id)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_RUNNING" });
    await expect(resumeCampaign(c.id)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_PAUSED" });
    await startCampaign(c.id);
    await expect(resumeCampaign(c.id)).rejects.toMatchObject({ code: "CAMPAIGN_NOT_PAUSED" });
    await pauseCampaign(c.id);
    await expect(startCampaign(c.id)).rejects.toThrow(/use Resume/);
  });
});

describe("messages + stats", () => {
  it("lists messages with a status filter, search and pagination", async () => {
    const c = await createCampaign(draftInput());
    await startCampaign(c.id);
    expect((await listCampaignMessages(c.id, { page: 1, limit: 20 })).total).toBe(5);
    const skipped = await listCampaignMessages(c.id, { page: 1, limit: 20, status: "skipped" });
    expect(skipped.total).toBe(3);
    expect(skipped.data[0].error?.code).toBeDefined();
    expect((await listCampaignMessages(c.id, { page: 1, limit: 2 })).data).toHaveLength(2);
    expect((await listCampaignMessages(c.id, { page: 1, limit: 20, search: "ANN@" })).total).toBe(
      1,
    );
  });

  it("draft stats: audience, capacity and ETA before starting", async () => {
    const c = await createCampaign(draftInput());
    const tueEarly = new Date("2026-10-20T08:00:00+05:30");
    const s = await getCampaignStats(c.id, tueEarly);
    expect(s).toMatchObject({
      status: "draft",
      totalMessages: 0,
      audience: { total: 5, sendable: 2, skipped: 3 },
      remaining: 2,
      usableInboxes: 2,
      dailyCapacity: 30,
      timezone: "Asia/Kolkata",
    });
    expect(s.eta).toBe(new Date("2026-10-20T18:00:00+05:30").toISOString());
    expect(s.nextWindowStart).toBe(new Date("2026-10-20T10:00:00+05:30").toISOString());
  });

  it("running stats: counts per status; no usable inbox → no ETA", async () => {
    const c = await createCampaign(draftInput());
    await startCampaign(c.id);
    const s = await getCampaignStats(c.id);
    expect(s.counts).toMatchObject({ pending: 2, skipped: 3, sent: 0, failed: 0 });
    expect(s.totalMessages).toBe(5);
    expect(s.remaining).toBe(2);
    await Inbox.updateMany({}, { status: "paused" });
    const paused = await getCampaignStats(c.id);
    expect(paused.dailyCapacity).toBe(0);
    expect(paused.eta).toBeNull();
  });

  it("list and detail include message counts", async () => {
    const c = await createCampaign(draftInput());
    await startCampaign(c.id);
    const [listed] = (await listCampaigns({ page: 1, limit: 20 })).data;
    expect(listed.counts.pending).toBe(2);
    expect(listed.totalMessages).toBe(5);
  });
});
