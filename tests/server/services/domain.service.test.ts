import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Domain, Event, Inbox, Message } from "@/server/db/models";
import type { DnsResolver } from "@/server/lib/dns-check";
import {
  createDomain,
  deleteDomain,
  getDomain,
  listDomains,
  recheckDomainDns,
  updateDomain,
} from "@/server/services/domain.service";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

const notFound = () => Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }));

/** Fake DNS where every domain is fully set up for Microsoft 365. */
const healthyResolver: DnsResolver = {
  resolveMx: async (host) => [{ exchange: `${host}.mail.protection.outlook.com`, priority: 0 }],
  resolveTxt: async (host) =>
    host.startsWith("_dmarc.")
      ? [["v=DMARC1; p=none"]]
      : [["v=spf1 include:spf.protection.outlook.com -all"]],
  resolveCname: async (host) => [`${host}.onmicrosoft.com`],
};
const emptyResolver: DnsResolver = {
  resolveMx: notFound,
  resolveTxt: notFound,
  resolveCname: notFound,
};

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

describe("createDomain", () => {
  it("adds the domain and runs the DNS check automatically", async () => {
    const domain = await createDomain({ name: "tryracko.in" }, { resolver: healthyResolver });
    expect(domain).toMatchObject({ name: "tryracko.in", status: "active", inboxCount: 0 });
    expect(domain.dns).toMatchObject({ spf: "pass", dkim: "pass", dmarc: "pass", mx: "pass" });
    expect(domain.dns.checkedAt).not.toBeNull();
    expect(await Event.countDocuments({ type: "domain.created" })).toBe(1);
  });

  it("rejects a duplicate with 409 and a clear message", async () => {
    await createDomain({ name: "getracko.in" }, { resolver: emptyResolver });
    await expect(
      createDomain({ name: "getracko.in" }, { resolver: emptyResolver }),
    ).rejects.toMatchObject({
      status: 409,
      code: "DOMAIN_EXISTS",
      message: 'The domain "getracko.in" has already been added',
    });
  });

  it("allows re-adding a domain that was deleted", async () => {
    const first = await createDomain({ name: "useracko.in" }, { resolver: emptyResolver });
    await deleteDomain(first.id);
    await expect(
      createDomain({ name: "useracko.in" }, { resolver: emptyResolver }),
    ).resolves.toMatchObject({ name: "useracko.in" });
  });
});

describe("listDomains", () => {
  it("paginates, sorts by name, hides deleted domains and counts inboxes", async () => {
    const a = await createDomain({ name: "b-domain.com" }, { resolver: emptyResolver });
    await createDomain({ name: "a-domain.com" }, { resolver: emptyResolver });
    const gone = await createDomain({ name: "c-domain.com" }, { resolver: emptyResolver });
    await deleteDomain(gone.id);
    await Inbox.create([
      { email: "one@b-domain.com", domainId: a.id },
      { email: "two@b-domain.com", domainId: a.id },
      { email: "old@b-domain.com", domainId: a.id, deletedAt: new Date() },
    ]);

    const page1 = await listDomains({ page: 1, limit: 1 });
    expect(page1).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(page1.data.map((d) => d.name)).toEqual(["a-domain.com"]);

    const page2 = await listDomains({ page: 2, limit: 1 });
    expect(page2.data[0]).toMatchObject({ name: "b-domain.com", inboxCount: 2 });
  });

  it("filters by search text and status", async () => {
    await createDomain({ name: "tryracko.in" }, { resolver: emptyResolver });
    const paused = await createDomain({ name: "getracko.in" }, { resolver: emptyResolver });
    await updateDomain(paused.id, { status: "paused" });

    expect((await listDomains({ page: 1, limit: 20, search: "try" })).total).toBe(1);
    expect((await listDomains({ page: 1, limit: 20, status: "paused" })).data[0].name).toBe(
      "getracko.in",
    );
  });
});

describe("updateDomain", () => {
  it("pausing puts its scheduled emails back in the queue", async () => {
    const domain = await createDomain({ name: "tryracko.in" }, { resolver: emptyResolver });
    const inbox = await Inbox.create({ email: "a@tryracko.in", domainId: domain.id });
    await Message.create({
      campaignId: new Types.ObjectId(),
      contactId: new Types.ObjectId(),
      toEmail: "lead@x.com",
      status: "scheduled",
      inboxId: inbox._id,
      scheduledAt: new Date(),
    });

    const updated = await updateDomain(domain.id, { status: "paused" });
    expect(updated.status).toBe("paused");
    const message = await Message.findOne().lean();
    expect(message).toMatchObject({ status: "pending", inboxId: null, scheduledAt: null });
  });

  it("can rename a domain without inboxes (and re-checks DNS)", async () => {
    const domain = await createDomain({ name: "typo-racko.in" }, { resolver: emptyResolver });
    const renamed = await updateDomain(
      domain.id,
      { name: "tryracko.in" },
      { resolver: healthyResolver },
    );
    expect(renamed.name).toBe("tryracko.in");
    expect(renamed.dns.spf).toBe("pass");
  });

  it("refuses to rename a domain that has inboxes", async () => {
    const domain = await createDomain({ name: "tryracko.in" }, { resolver: emptyResolver });
    await Inbox.create({ email: "a@tryracko.in", domainId: domain.id });
    await expect(updateDomain(domain.id, { name: "other.in" })).rejects.toMatchObject({
      status: 409,
      code: "DOMAIN_HAS_INBOXES",
    });
  });

  it("refuses to rename onto an existing domain", async () => {
    await createDomain({ name: "tryracko.in" }, { resolver: emptyResolver });
    const other = await createDomain({ name: "getracko.in" }, { resolver: emptyResolver });
    await expect(updateDomain(other.id, { name: "tryracko.in" })).rejects.toMatchObject({
      status: 409,
      code: "DOMAIN_EXISTS",
    });
  });
});

describe("tracking address", () => {
  it("sets and removes the tracking address (the domain itself or a subdomain of it)", async () => {
    const domain = await createDomain({ name: "tryracko.in" }, { resolver: emptyResolver });
    expect(domain.trackingHost).toBeNull();

    expect((await updateDomain(domain.id, { trackingHost: "go.tryracko.in" })).trackingHost).toBe(
      "go.tryracko.in",
    );
    expect((await updateDomain(domain.id, { trackingHost: "tryracko.in" })).trackingHost).toBe(
      "tryracko.in",
    );
    expect((await updateDomain(domain.id, { trackingHost: null })).trackingHost).toBeNull();
    expect(await Event.countDocuments({ type: "domain.tracking_host" })).toBe(3);
  });

  it.each(["go.getracko.ai", "tryracko.in.evil.com", "eviltryracko.in"])(
    "refuses an address that is not on the domain: %s",
    async (trackingHost) => {
      const domain = await createDomain({ name: "tryracko.in" }, { resolver: emptyResolver });
      await expect(updateDomain(domain.id, { trackingHost })).rejects.toMatchObject({
        status: 400,
        code: "TRACKING_HOST_NOT_ON_DOMAIN",
      });
    },
  );

  it("renaming drops an address that no longer belongs to the domain", async () => {
    const domain = await createDomain({ name: "typo-racko.in" }, { resolver: emptyResolver });
    await updateDomain(domain.id, { trackingHost: "go.typo-racko.in" });
    const renamed = await updateDomain(
      domain.id,
      { name: "tryracko.in" },
      { resolver: emptyResolver },
    );
    expect(renamed.trackingHost).toBeNull();
  });
});

describe("deleteDomain", () => {
  it("soft-deletes the domain and its inboxes, keeps the history", async () => {
    const domain = await createDomain({ name: "tryracko.in" }, { resolver: emptyResolver });
    await Inbox.create([
      { email: "a@tryracko.in", domainId: domain.id },
      { email: "b@tryracko.in", domainId: domain.id },
    ]);

    expect(await deleteDomain(domain.id)).toEqual({ id: domain.id, deletedInboxes: 2 });
    expect(await Domain.countDocuments()).toBe(1); // still in the database
    expect(await Domain.countDocuments({ deletedAt: null })).toBe(0);
    expect(await Inbox.countDocuments({ deletedAt: null })).toBe(0);
    await expect(getDomain(domain.id)).rejects.toMatchObject({ status: 404 });
  });

  it("404s for an unknown or already deleted domain", async () => {
    await expect(deleteDomain(String(new Types.ObjectId()))).rejects.toMatchObject({
      status: 404,
      code: "DOMAIN_NOT_FOUND",
    });
  });
});

describe("recheckDomainDns", () => {
  it("stores the new DNS results", async () => {
    const domain = await createDomain({ name: "tryracko.in" }, { resolver: emptyResolver });
    expect(domain.dns.mx).toBe("fail");
    const rechecked = await recheckDomainDns(domain.id, { resolver: healthyResolver });
    expect(rechecked.dns.mx).toBe("pass");
    expect(rechecked.dns.records.mx).toEqual(["0 tryracko.in.mail.protection.outlook.com"]);
  });
});
