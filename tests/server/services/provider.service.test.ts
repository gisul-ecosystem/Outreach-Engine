import { Types } from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Campaign, Contact, Domain, Inbox, Message, ProviderConnection } from "@/server/db/models";
import { decrypt } from "@/server/lib/crypto";
import type { EmailProvider } from "@/server/providers";
import { resumeInbox, updateInbox } from "@/server/services/inbox.service";
import {
  createProviderConnection,
  deleteProviderConnection,
  listProviders,
  updateProviderConnection,
  verifyProviderConnection,
} from "@/server/services/provider.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

const SECRET = "Abc8Q~very-secret-client-value";
const input = {
  name: "Racko M365",
  type: "microsoft" as const,
  tenantId: "11111111-2222-3333-4444-555555555555",
  clientId: "66666666-7777-8888-9999-000000000000",
  clientSecret: SECRET,
};
const okProvider = { verifyConnection: async () => ({ ok: true }) } as EmailProvider;
const badProvider = {
  verifyConnection: async () => ({
    ok: false,
    error: "The client secret is wrong or has expired.",
  }),
} as EmailProvider;

let consoleOutput: string[] = [];
beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  consoleOutput = [];
  for (const method of ["log", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args) => {
      consoleOutput.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => {
  // Safety rule: the secret must never be logged.
  expect(consoleOutput.join("\n")).not.toContain(SECRET);
  vi.restoreAllMocks();
});

describe("provider connections", () => {
  it("stores the secret encrypted and never returns it", async () => {
    const created = await createProviderConnection(input);
    expect(JSON.stringify(created)).not.toContain(SECRET);
    expect(created).toMatchObject({ status: "unchecked", secretSet: true, inboxCount: 0 });

    const raw = await ProviderConnection.findById(created.id).select("+clientSecretEnc").lean();
    expect(raw?.clientSecretEnc).not.toContain(SECRET);
    expect(decrypt(raw!.clientSecretEnc!)).toBe(SECRET);

    const list = await listProviders({ page: 1, limit: 20 });
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect(JSON.stringify(list)).not.toContain(raw!.clientSecretEnc!);
  });

  it("verify: connected on success, error + readable message on failure", async () => {
    const created = await createProviderConnection(input);
    const ok = await verifyProviderConnection(created.id, { provider: okProvider });
    expect(ok).toMatchObject({ status: "connected", lastError: null });
    expect(ok.lastCheckedAt).not.toBeNull();

    const bad = await verifyProviderConnection(created.id, { provider: badProvider });
    expect(bad).toMatchObject({
      status: "error",
      lastError: "The client secret is wrong or has expired.",
    });
  });

  it("changing credentials resets the status to unchecked", async () => {
    const created = await createProviderConnection(input);
    await verifyProviderConnection(created.id, { provider: okProvider });

    const renamed = await updateProviderConnection(created.id, { name: "New name" });
    expect(renamed).toMatchObject({ name: "New name", status: "connected" });

    const newSecret = await updateProviderConnection(created.id, {
      clientSecret: "another-secret-9",
    });
    expect(newSecret.status).toBe("unchecked");
    const raw = await ProviderConnection.findById(created.id).select("+clientSecretEnc").lean();
    expect(decrypt(raw!.clientSecretEnc!)).toBe("another-secret-9");
  });

  it("deletes an unused connection", async () => {
    const created = await createProviderConnection(input);
    await expect(deleteProviderConnection(created.id)).resolves.toEqual({
      id: created.id,
      pausedInboxes: 0,
    });
    expect((await listProviders({ page: 1, limit: 20 })).total).toBe(0);
  });

  it("deleting a connection in use pauses and unlinks its inboxes and releases their queue", async () => {
    const created = await createProviderConnection(input);
    const other = await createProviderConnection({ ...input, name: "Other M365" });
    const domain = await Domain.create({ name: "tryracko.in", providerConnectionId: created.id });
    const inbox = await Inbox.create({
      email: "a@tryracko.in",
      domainId: domain._id,
      providerConnectionId: created.id,
    });
    const untouched = await Inbox.create({
      email: "b@tryracko.in",
      domainId: domain._id,
      providerConnectionId: other.id,
    });
    const campaign = await Campaign.create({ name: "C", listId: new Types.ObjectId() });
    const contact = await Contact.create({ email: "x@example.com" });
    const message = await Message.create({
      campaignId: campaign._id,
      contactId: contact._id,
      toEmail: contact.email,
      inboxId: inbox._id,
      status: "scheduled",
      scheduledAt: new Date(),
    });

    await expect(deleteProviderConnection(created.id)).resolves.toEqual({
      id: created.id,
      pausedInboxes: 1,
    });

    const after = await Inbox.findById(inbox._id).lean();
    expect(after).toMatchObject({ status: "paused", providerConnectionId: null, deletedAt: null });
    expect(after?.pauseReason).toMatch(/Provider deleted/);
    expect((await Inbox.findById(untouched._id).lean())?.status).toBe("active");
    expect((await Domain.findById(domain._id).lean())?.providerConnectionId).toBeNull();
    expect(await Message.findById(message._id).lean()).toMatchObject({
      status: "pending",
      inboxId: null,
    });

    // Cannot resume until a provider is chosen again.
    await expect(resumeInbox(String(inbox._id))).rejects.toMatchObject({ code: "NO_PROVIDER" });
    await updateInbox(String(inbox._id), { providerConnectionId: other.id });
    await expect(resumeInbox(String(inbox._id))).resolves.toMatchObject({ status: "active" });
  });
});
