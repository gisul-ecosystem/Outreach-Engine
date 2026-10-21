import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Domain, Inbox, ProviderConnection } from "@/server/db/models";
import { decrypt } from "@/server/lib/crypto";
import type { EmailProvider } from "@/server/providers";
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

  it("refuses to delete a connection that inboxes still use", async () => {
    const created = await createProviderConnection(input);
    const domain = await Domain.create({ name: "tryracko.in" });
    const inbox = await Inbox.create({
      email: "a@tryracko.in",
      domainId: domain._id,
      providerConnectionId: created.id,
    });
    await expect(deleteProviderConnection(created.id)).rejects.toMatchObject({
      status: 409,
      code: "PROVIDER_IN_USE",
    });

    await Inbox.updateOne({ _id: inbox._id }, { deletedAt: new Date() });
    await expect(deleteProviderConnection(created.id)).resolves.toEqual({ id: created.id });
    expect((await listProviders({ page: 1, limit: 20 })).total).toBe(0);
  });
});
