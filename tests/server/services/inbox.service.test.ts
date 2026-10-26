import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Domain,
  Inbox,
  Message,
  ProviderConnection,
  Settings,
  Suppression,
} from "@/server/db/models";
import { encrypt } from "@/server/lib/crypto";
import { ProviderError, type EmailProvider } from "@/server/providers";
import {
  createInbox,
  deleteInbox,
  discoverMailboxes,
  importInboxes,
  listInboxes,
  pauseInbox,
  resumeInbox,
  testSendFromInbox,
  updateInbox,
} from "@/server/services/inbox.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

let domainId: string;
let providerId: string;

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  vi.restoreAllMocks();
  const domain = await Domain.create({ name: "tryracko.in" });
  const provider = await ProviderConnection.create({
    name: "M365",
    type: "microsoft",
    tenantId: "contoso.onmicrosoft.com",
    clientId: "00000000-0000-0000-0000-000000000000",
    clientSecretEnc: encrypt("secret-value-1"),
  });
  domainId = String(domain._id);
  providerId = String(provider._id);
});

const base = () => ({
  domainId,
  providerConnectionId: providerId,
  email: "sales@tryracko.in",
  displayName: "Racko Sales",
});

describe("createInbox", () => {
  it("creates an inbox with the default limits from Settings", async () => {
    await Settings.create({
      defaultDailyLimit: 12,
      defaultMinGapSeconds: 600,
      defaultMaxGapSeconds: 1200,
    });
    const inbox = await createInbox(base());
    expect(inbox).toMatchObject({
      email: "sales@tryracko.in",
      domainName: "tryracko.in",
      providerName: "M365",
      status: "active",
      dailyLimit: 12,
      minGapSeconds: 600,
      maxGapSeconds: 1200,
    });
  });

  it("uses the defaults when there are no settings (10/day warm-up, 480–900 s)", async () => {
    const inbox = await createInbox(base());
    expect(inbox).toMatchObject({ dailyLimit: 10, minGapSeconds: 480, maxGapSeconds: 900 });
  });

  it("requires the email to match the domain", async () => {
    await expect(createInbox({ ...base(), email: "sales@getracko.in" })).rejects.toMatchObject({
      status: 400,
      code: "EMAIL_DOMAIN_MISMATCH",
    });
  });

  it("rejects duplicates with 409", async () => {
    await createInbox(base());
    await expect(createInbox(base())).rejects.toMatchObject({ status: 409, code: "INBOX_EXISTS" });
  });

  it("rejects an unknown domain or provider", async () => {
    await expect(
      createInbox({ ...base(), domainId: String(new Types.ObjectId()) }),
    ).rejects.toMatchObject({
      code: "INVALID_DOMAIN",
    });
    await expect(
      createInbox({ ...base(), providerConnectionId: String(new Types.ObjectId()) }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER" });
  });

  it("rejects min gap > max gap (also when mixed with defaults)", async () => {
    await expect(createInbox({ ...base(), minGapSeconds: 1000 })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("list / update / pause / resume / delete", () => {
  it("lists with domain + provider names and filters by domain", async () => {
    await createInbox(base());
    const other = await Domain.create({ name: "getracko.in" });
    await createInbox({ ...base(), domainId: String(other._id), email: "hi@getracko.in" });

    expect((await listInboxes({ page: 1, limit: 20 })).total).toBe(2);
    const filtered = await listInboxes({ page: 1, limit: 20, domainId });
    expect(filtered.data.map((i) => i.email)).toEqual(["sales@tryracko.in"]);
  });

  it("updates limits and checks the gap order against saved values", async () => {
    const inbox = await createInbox(base());
    expect((await updateInbox(inbox.id, { dailyLimit: 15 })).dailyLimit).toBe(15);
    await expect(updateInbox(inbox.id, { minGapSeconds: 5000 })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("pause releases scheduled emails; resume clears the reason and failure count", async () => {
    const inbox = await createInbox(base());
    await Inbox.updateOne({ _id: inbox.id }, { consecutiveFailures: 3 });
    await Message.create({
      campaignId: new Types.ObjectId(),
      contactId: new Types.ObjectId(),
      toEmail: "lead@x.com",
      status: "scheduled",
      inboxId: inbox.id,
      scheduledAt: new Date(),
    });

    const paused = await pauseInbox(inbox.id);
    expect(paused).toMatchObject({ status: "paused", pauseReason: "Paused by user" });
    expect(await Message.findOne().lean()).toMatchObject({ status: "pending", inboxId: null });

    const resumed = await resumeInbox(inbox.id);
    expect(resumed).toMatchObject({ status: "active", pauseReason: null, consecutiveFailures: 0 });
  });

  it("delete is a soft delete and frees the email for re-use", async () => {
    const inbox = await createInbox(base());
    await deleteInbox(inbox.id);
    expect(await Inbox.countDocuments()).toBe(1);
    expect((await listInboxes({ page: 1, limit: 20 })).total).toBe(0);
    await expect(createInbox(base())).resolves.toBeTruthy();
  });
});

describe("testSendFromInbox", () => {
  it("in DRY_RUN uses the FakeProvider: logged, not sent", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const inbox = await createInbox(base());
    const result = await testSendFromInbox(inbox.id, "me@example.com");
    expect(result).toMatchObject({
      mode: "dry-run",
      to: "me@example.com",
      from: "sales@tryracko.in",
    });
    expect(result.providerMessageId).toMatch(/^fake-/);
    expect(log.mock.calls.flat().join(" ")).toContain("[DRY RUN] not really sent");
  });

  it("never sends to a suppressed address", async () => {
    const inbox = await createInbox(base());
    await Suppression.create({ email: "no@example.com", reason: "manual" });
    const send = vi.fn();
    await expect(
      testSendFromInbox(inbox.id, "no@example.com", {
        provider: { send } as unknown as EmailProvider,
      }),
    ).rejects.toMatchObject({ status: 409, code: "SUPPRESSED" });
    expect(send).not.toHaveBeenCalled();
  });

  it("turns a provider error into a readable 502", async () => {
    const inbox = await createInbox(base());
    const provider = {
      send: async () => {
        throw new ProviderError("auth", "ErrorAccessDenied", "Access is denied.");
      },
    } as unknown as EmailProvider;
    await expect(testSendFromInbox(inbox.id, "me@example.com", { provider })).rejects.toMatchObject(
      {
        status: 502,
        code: "SEND_FAILED",
      },
    );
  });
});

describe("importing mailboxes from the provider", () => {
  const provider = (mailboxes: { email: string; displayName: string; enabled: boolean }[]) =>
    ({ listMailboxes: vi.fn().mockResolvedValue(mailboxes) }) as unknown as EmailProvider;
  const boxes = [
    { email: "sales@tryracko.in", displayName: "Sales", enabled: true },
    { email: "hello@tryracko.in", displayName: "Hello", enabled: true },
  ];

  it("marks mailboxes that are already inboxes", async () => {
    await createInbox(base());
    const result = await discoverMailboxes(domainId, {
      providerConnectionId: providerId,
      provider: provider(boxes),
    });
    expect(result.mailboxes.map((m) => [m.email, m.alreadyAdded])).toEqual([
      ["sales@tryracko.in", true],
      ["hello@tryracko.in", false],
    ]);
  });

  it("imports chosen mailboxes (active by default) and skips unknown or duplicate ones", async () => {
    await createInbox(base());
    const result = await importInboxes(
      domainId,
      {
        providerConnectionId: providerId,
        emails: ["hello@tryracko.in", "sales@tryracko.in", "ghost@tryracko.in"],
      },
      { provider: provider(boxes) },
    );
    expect(result.imported).toEqual(["hello@tryracko.in"]);
    expect(result.skipped.map((s) => s.email).sort()).toEqual([
      "ghost@tryracko.in",
      "sales@tryracko.in",
    ]);
    const inbox = await Inbox.findOne({ email: "hello@tryracko.in" }).lean();
    expect(inbox?.status).toBe("active");
    expect(inbox?.displayName).toBe("Hello");
  });

  it("uses the only provider connection when none is given", async () => {
    const result = await discoverMailboxes(domainId, { provider: provider(boxes) });
    expect(result.providerConnectionId).toBe(providerId);
  });

  it("needs a provider connection", async () => {
    await ProviderConnection.deleteMany({});
    await expect(discoverMailboxes(domainId, { provider: provider(boxes) })).rejects.toMatchObject({
      code: "NO_PROVIDER",
    });
  });
});

describe("importInboxes startPaused", () => {
  it("pauses the new inboxes when asked", async () => {
    const fake = {
      listMailboxes: vi
        .fn()
        .mockResolvedValue([{ email: "team@tryracko.in", displayName: "Team", enabled: true }]),
    } as unknown as EmailProvider;
    await importInboxes(
      domainId,
      { providerConnectionId: providerId, emails: ["team@tryracko.in"], startPaused: true },
      { provider: fake },
    );
    expect((await Inbox.findOne({ email: "team@tryracko.in" }).lean())?.status).toBe("paused");
  });
});
