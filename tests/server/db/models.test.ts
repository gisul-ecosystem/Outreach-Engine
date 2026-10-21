import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  Campaign,
  Contact,
  Domain,
  Event,
  Inbox,
  Message,
  ProviderConnection,
  Settings,
  Suppression,
  User,
} from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

const DUPLICATE_KEY = 11000;

async function expectDuplicate(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: DUPLICATE_KEY });
}

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

describe("users", () => {
  it("stores email lowercase + trimmed and rejects duplicates", async () => {
    const user = await User.create({ email: "  Admin@Racko.IN ", passwordHash: "x" });
    expect(user.email).toBe("admin@racko.in");
    await expectDuplicate(User.create({ email: "admin@racko.in", passwordHash: "y" }));
  });

  it("does not load passwordHash unless asked for", async () => {
    await User.create({ email: "a@b.co", passwordHash: "secret-hash" });
    const plain = await User.findOne({ email: "a@b.co" }).lean();
    expect(plain).not.toHaveProperty("passwordHash");
    const withHash = await User.findOne({ email: "a@b.co" }).select("+passwordHash").lean();
    expect(withHash?.passwordHash).toBe("secret-hash");
  });
});

describe("domains", () => {
  it("rejects a duplicate name among non-deleted domains", async () => {
    await Domain.create({ name: "tryracko.in" });
    await expectDuplicate(Domain.create({ name: "TRYRACKO.IN" }));
  });

  it("allows re-adding a name after the old one was soft-deleted", async () => {
    const old = await Domain.create({ name: "getracko.in" });
    await Domain.updateOne({ _id: old._id }, { deletedAt: new Date() });
    await expect(Domain.create({ name: "getracko.in" })).resolves.toBeTruthy();
    expect(await Domain.countDocuments({ name: "getracko.in" })).toBe(2);
    expect(await Domain.countDocuments(notDeleted({ name: "getracko.in" }))).toBe(1);
  });

  it("applies defaults: active, DNS unknown, not deleted", async () => {
    const domain = await Domain.create({ name: "useracko.in" });
    expect(domain.status).toBe("active");
    expect(domain.dns?.spf).toBe("unknown");
    expect(domain.dns?.records?.mx).toEqual([]);
    expect(domain.deletedAt).toBeNull();
  });
});

describe("inboxes", () => {
  it("rejects a duplicate email among non-deleted inboxes, allows it after soft delete", async () => {
    const domainId = new Types.ObjectId();
    const first = await Inbox.create({ email: "sales@tryracko.in", domainId });
    await expectDuplicate(Inbox.create({ email: "Sales@TryRacko.in", domainId }));
    await Inbox.updateOne({ _id: first._id }, { deletedAt: new Date() });
    await expect(Inbox.create({ email: "sales@tryracko.in", domainId })).resolves.toBeTruthy();
  });

  it("applies sending defaults (30/day, 480–900 s gaps)", async () => {
    const inbox = await Inbox.create({ email: "a@tryracko.in", domainId: new Types.ObjectId() });
    expect(inbox.dailyLimit).toBe(30);
    expect(inbox.minGapSeconds).toBe(480);
    expect(inbox.maxGapSeconds).toBe(900);
    expect(inbox.consecutiveFailures).toBe(0);
    expect(inbox.status).toBe("active");
  });
});

describe("contacts and suppressions", () => {
  it("contacts: email is unique (even across soft-deleted)", async () => {
    const c = await Contact.create({ email: "lead@company.com" });
    await Contact.updateOne({ _id: c._id }, { deletedAt: new Date() });
    await expectDuplicate(Contact.create({ email: "LEAD@company.com" }));
  });

  it("suppressions: email is unique", async () => {
    await Suppression.create({ email: "no@thanks.com", reason: "manual" });
    await expectDuplicate(Suppression.create({ email: "no@thanks.com", reason: "bounced" }));
  });

  it("rejects values outside the enums", async () => {
    // `as never` lets us pass values TypeScript already knows are invalid, to test the database side.
    await expect(
      Suppression.create({ email: "x@y.com", reason: "spam" as never }),
    ).rejects.toThrow();
    await expect(Contact.create({ email: "x@y.com", status: "maybe" as never })).rejects.toThrow();
  });
});

describe("messages", () => {
  it("never allows the same campaign + contact twice", async () => {
    const campaignId = new Types.ObjectId();
    const contactId = new Types.ObjectId();
    await Message.create({ campaignId, contactId, toEmail: "lead@company.com" });
    await expectDuplicate(Message.create({ campaignId, contactId, toEmail: "lead@company.com" }));
    // Same contact in a different campaign is fine.
    await expect(
      Message.create({ campaignId: new Types.ObjectId(), contactId, toEmail: "lead@company.com" }),
    ).resolves.toBeTruthy();
  });

  it("has every queue index from the build plan", async () => {
    const keys = (await Message.listIndexes()).map((index) => JSON.stringify(index.key));
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify({ campaignId: 1, contactId: 1 }),
        JSON.stringify({ status: 1, scheduledAt: 1 }),
        JSON.stringify({ inboxId: 1, sentAt: -1 }),
        JSON.stringify({ campaignId: 1, status: 1 }),
      ]),
    );
  });

  it("starts as pending with no inbox and zero attempts", async () => {
    const msg = await Message.create({
      campaignId: new Types.ObjectId(),
      contactId: new Types.ObjectId(),
      toEmail: "a@b.co",
    });
    expect(msg.status).toBe("pending");
    expect(msg.inboxId).toBeNull();
    expect(msg.attempts).toBe(0);
  });
});

describe("other models", () => {
  it("events expire after 90 days (TTL index)", async () => {
    const ttl = (await Event.listIndexes()).find((index) => index.key.createdAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(90 * 24 * 60 * 60);
  });

  it("campaigns default to draft with a Mon–Fri 10:00–18:00 window", async () => {
    const campaign = await Campaign.create({
      name: "Test",
      listId: new Types.ObjectId(),
      subjectTemplate: "Hi {{firstName}}",
      bodyTemplate: "Hello",
    });
    expect(campaign.status).toBe("draft");
    expect(campaign.sendWindow?.startMinute).toBe(600);
    expect(campaign.sendWindow?.endMinute).toBe(1080);
    expect(campaign.sendWindow?.days).toEqual([1, 2, 3, 4, 5]);
    expect((await Campaign.listIndexes()).some((index) => index.key.status === 1)).toBe(true);
  });

  it("provider connections hide the encrypted secret by default", async () => {
    await ProviderConnection.create({ name: "M365", type: "microsoft", clientSecretEnc: "v1:enc" });
    const found = await ProviderConnection.findOne().lean();
    expect(found).not.toHaveProperty("clientSecretEnc");
    expect(found?.status).toBe("unchecked");
  });

  it("settings defaults match the build plan", async () => {
    const settings = await Settings.create({});
    expect(settings.timezone).toBe("Asia/Kolkata");
    expect(settings.defaultDailyLimit).toBe(30);
    expect(settings.defaultMinGapSeconds).toBe(480);
    expect(settings.defaultMaxGapSeconds).toBe(900);
  });
});
