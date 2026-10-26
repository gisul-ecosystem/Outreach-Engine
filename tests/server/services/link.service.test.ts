import { Types } from "mongoose";
import Papa from "papaparse";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Contact, Domain, LinkClick, List, TrackedEmail, TrackedLink } from "@/server/db/models";
import {
  getContactTimeline,
  getOrCreateLink,
  importWithLinks,
  listClicks,
  listContactLinks,
  listLinksCsv,
  trackingConfig,
} from "@/server/services/link.service";
import { listTrackedEmails } from "@/server/services/tracked-email.service";
import type { ClickVerdict } from "@/shared/enums";
import { listTrackedEmailsQuerySchema } from "@/shared/tracked-email";
import { listClicksQuerySchema } from "@/shared/tracking";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const HOME = "https://racko.ai";

async function contact(email = "priya@client.com", firstName = "Priya") {
  return Contact.create({ email, firstName, lastName: "S" });
}

describe("getOrCreateLink", () => {
  it("creates a link with a random token, then reuses it for the same destination", async () => {
    const c = await contact();
    const first = await getOrCreateLink(String(c._id), {
      destinationUrl: HOME,
      label: "take a look at Racko",
      new: false,
    });
    expect(first.url).toBe(`http://localhost:3000/r/${first.token}`);
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(first.token).not.toContain("priya");
    expect(first.destinationUrl).toBe("https://racko.ai/");

    const again = await getOrCreateLink(String(c._id), {
      destinationUrl: HOME,
      label: "",
      new: false,
    });
    expect(again.id).toBe(first.id);
    expect(again.label).toBe("take a look at Racko");
  });

  it('"new" makes a fresh link; another destination gets its own link', async () => {
    const c = await contact();
    const id = String(c._id);
    const a = await getOrCreateLink(id, { destinationUrl: HOME, label: "", new: false });
    const fresh = await getOrCreateLink(id, { destinationUrl: HOME, label: "", new: true });
    const pricing = await getOrCreateLink(id, {
      destinationUrl: "https://racko.ai/pricing",
      label: "",
      new: false,
    });
    expect(new Set([a.token, fresh.token, pricing.token]).size).toBe(3);
    // The newest one is reused from now on; the old one keeps working.
    expect((await getOrCreateLink(id, { destinationUrl: HOME, label: "", new: false })).id).toBe(
      fresh.id,
    );
    expect(await listContactLinks(id)).toHaveLength(3);
  });

  it.each(["https://evil.com/", "http://racko.ai/", "https://racko.ai.evil.com/"])(
    "refuses a destination that is not allowed: %s",
    async (destinationUrl) => {
      const c = await contact();
      await expect(
        getOrCreateLink(String(c._id), { destinationUrl, label: "", new: false }),
      ).rejects.toMatchObject({ status: 400, code: "DESTINATION_NOT_ALLOWED" });
      expect(await TrackedLink.countDocuments()).toBe(0);
    },
  );

  it("404 for an unknown or deleted contact", async () => {
    const c = await contact();
    await Contact.updateOne({ _id: c._id }, { $set: { deletedAt: new Date() } });
    await expect(
      getOrCreateLink(String(c._id), { destinationUrl: HOME, label: "", new: false }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("listLinksCsv", () => {
  it("one link per contact of the list, creating the missing ones and reusing existing ones", async () => {
    const list = await List.create({ name: "Q4 Leads" });
    const a = await Contact.create({ email: "a@x.com", firstName: "Ann", listIds: [list._id] });
    await Contact.create({ email: "=cmd@x.com", firstName: "=HYPERLINK()", listIds: [list._id] });
    await Contact.create({ email: "other@x.com" }); // not in the list
    const existing = await getOrCreateLink(String(a._id), {
      destinationUrl: HOME,
      label: "",
      new: false,
    });

    const { filename, csv } = await listLinksCsv(String(list._id));
    expect(filename).toBe("links-q4-leads.csv");
    const rows = Papa.parse<Record<string, string>>(csv, { header: true }).data;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.email === "a@x.com")!.link).toBe(existing.url);
    // Cells that a spreadsheet would run as a formula are escaped.
    expect(csv).toContain("'=HYPERLINK()");
    expect(await TrackedLink.countDocuments()).toBe(2);

    // Downloading again creates nothing new.
    await listLinksCsv(String(list._id));
    expect(await TrackedLink.countDocuments()).toBe(2);
  });

  it("refuses a destination that is not allowed", async () => {
    const list = await List.create({ name: "L" });
    await expect(
      listLinksCsv(String(list._id), { destinationUrl: "https://evil.com" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("uses the chosen destination + sending domain, and remembers the choice on the list", async () => {
    const list = await List.create({ name: "L" });
    await Contact.create({ email: "a@x.com", listIds: [list._id] });
    const domain = await Domain.create({ name: "tryracko.in", trackingHost: "go.tryracko.in" });

    const { csv } = await listLinksCsv(String(list._id), {
      destinationUrl: "https://racko.ai/pricing",
      domainId: String(domain._id),
    });
    const [row] = Papa.parse<Record<string, string>>(csv, { header: true }).data;
    expect(row.link).toMatch(/^https:\/\/go\.tryracko\.in\/r\/[A-Za-z0-9_-]{12}$/);
    expect(row.destination).toBe("https://racko.ai/pricing");

    const saved = await List.findById(list._id).lean();
    expect(saved).toMatchObject({ linkDestinationUrl: "https://racko.ai/pricing" });
    expect(String(saved!.linkDomainId)).toBe(String(domain._id));

    // Same choice again → the same links.
    const again = await listLinksCsv(String(list._id), {
      destinationUrl: "https://racko.ai/pricing",
      domainId: String(domain._id),
    });
    expect(again.csv).toBe(csv);
  });
});

describe("links for a sending domain", () => {
  it("get the domain's tracking address, separate from the default links", async () => {
    const c = await contact();
    const domain = await Domain.create({ name: "tryracko.in", trackingHost: "go.tryracko.in" });
    const id = String(c._id);

    const plain = await getOrCreateLink(id, { destinationUrl: HOME, label: "", new: false });
    const forDomain = await getOrCreateLink(id, {
      destinationUrl: HOME,
      domainId: String(domain._id),
      label: "",
      new: false,
    });
    expect(plain.url).toBe(`http://localhost:3000/r/${plain.token}`);
    expect(forDomain.url).toBe(`https://go.tryracko.in/r/${forDomain.token}`);
    expect(forDomain.trackingHost).toBe("go.tryracko.in");
    expect(forDomain.token).not.toBe(plain.token);

    // Each is reused for its own domain.
    const again = await getOrCreateLink(id, {
      destinationUrl: HOME,
      domainId: String(domain._id),
      label: "",
      new: false,
    });
    expect(again.id).toBe(forDomain.id);
    expect((await getOrCreateLink(id, { destinationUrl: HOME, label: "", new: false })).id).toBe(
      plain.id,
    );
  });

  it("refuses a domain without a tracking address (the link would not match the email)", async () => {
    const c = await contact();
    const domain = await Domain.create({ name: "userako.in" });
    await expect(
      getOrCreateLink(String(c._id), {
        destinationUrl: HOME,
        domainId: String(domain._id),
        label: "",
        new: false,
      }),
    ).rejects.toMatchObject({ status: 400, code: "TRACKING_HOST_NOT_SET" });
    expect(await TrackedLink.countDocuments()).toBe(0);
  });

  it("links made before tracking hosts existed are still reused as default links", async () => {
    const c = await contact();
    // Written the old way: no trackingHost field at all.
    await TrackedLink.collection.insertOne({
      token: "oldToken12345",
      contactId: c._id,
      destinationUrl: "https://racko.ai/",
      label: "",
      sentEmailIds: [],
      clickCount: 0,
      realClickCount: 0,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const link = await getOrCreateLink(String(c._id), {
      destinationUrl: HOME,
      label: "",
      new: false,
    });
    expect(link.token).toBe("oldToken12345");
    expect(link.url).toBe("http://localhost:3000/r/oldToken12345");
  });
});

describe("importWithLinks", () => {
  const CSV = "email,first_name\nann@x.com,Ann\nbob@x.com,Bob\n";
  const MAPPING = { email: "email", first_name: "firstName" } as const;

  it("imports and makes a link for every contact of the list, to the chosen page and domain", async () => {
    const list = await List.create({ name: "Import" });
    const domain = await Domain.create({ name: "getracko.ai", trackingHost: "go.getracko.ai" });

    const report = await importWithLinks(CSV, { ...MAPPING }, String(list._id), {
      destinationUrl: "https://racko.ai/demo",
      domainId: String(domain._id),
    });
    expect(report.created).toBe(2);
    expect(report.links).toEqual({
      created: 2,
      total: 2,
      destinationUrl: "https://racko.ai/demo",
      baseUrl: "https://go.getracko.ai",
      domainId: String(domain._id),
    });
    const links = await TrackedLink.find().lean();
    expect(links).toHaveLength(2);
    expect(links.every((l) => l.trackingHost === "go.getracko.ai")).toBe(true);

    // The download afterwards gives exactly these links.
    const { csv } = await listLinksCsv(String(list._id), {
      destinationUrl: "https://racko.ai/demo",
      domainId: String(domain._id),
    });
    const tokens = Papa.parse<Record<string, string>>(csv, { header: true }).data.map((r) =>
      r.link.split("/r/")[1],
    );
    expect(tokens.sort()).toEqual(links.map((l) => l.token).sort());
  });

  it("checks the link choice BEFORE importing: a bad destination imports nothing", async () => {
    const list = await List.create({ name: "Import" });
    await expect(
      importWithLinks(CSV, { ...MAPPING }, String(list._id), {
        destinationUrl: "https://evil.com",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await Contact.countDocuments()).toBe(0);
  });

  it("without a link choice it is a plain import", async () => {
    const list = await List.create({ name: "Import" });
    const report = await importWithLinks(CSV, { ...MAPPING }, String(list._id));
    expect(report.links).toBeNull();
    expect(await TrackedLink.countDocuments()).toBe(0);
  });
});

describe("clicks and timeline", () => {
  async function seed() {
    const c = await contact();
    const link = await getOrCreateLink(String(c._id), {
      destinationUrl: HOME,
      label: "",
      new: false,
    });
    const click = (verdict: ClickVerdict, at: string) => ({
      linkId: new Types.ObjectId(link.id),
      token: link.token,
      contactId: c._id,
      at: new Date(at),
      method: "GET",
      verdict,
      reasons: [`${verdict} reason`],
    });
    await LinkClick.create([
      click("click", "2026-10-20T10:00:00Z"),
      click("suspicious", "2026-10-20T09:00:00Z"),
      click("bot", "2026-10-20T08:00:00Z"),
    ]);
    return { c, link };
  }

  it("lists real clicks only by default; 'all' includes bots", async () => {
    const { c } = await seed();
    const real = await listClicks(listClicksQuerySchema.parse({}));
    expect(real.total).toBe(1);
    expect(real.data[0]).toMatchObject({
      verdict: "click",
      destinationUrl: "https://racko.ai/",
      contact: { id: String(c._id), email: "priya@client.com", name: "Priya S" },
    });
    expect(
      (await listClicks(listClicksQuerySchema.parse({ include: "real-and-maybe" }))).total,
    ).toBe(2);
    const all = await listClicks(listClicksQuerySchema.parse({ include: "all" }));
    expect(all.data.map((c) => c.verdict)).toEqual(["click", "suspicious", "bot"]);
  });

  it("the contact timeline mixes emails, replies and clicks, newest first", async () => {
    const { c } = await seed();
    await TrackedEmail.create({
      inboxId: c._id,
      inboxEmail: "sales@tryracko.in",
      source: "manual",
      internetMessageId: "<m@x>",
      subject: "Hello Priya",
      recipients: ["priya@client.com"],
      contactIds: [c._id],
      sentAt: new Date("2026-10-20T07:00:00Z"),
      repliedAt: new Date("2026-10-20T11:00:00Z"),
      replyFromEmail: "priya@client.com",
    });
    const timeline = await getContactTimeline(String(c._id));
    expect(timeline.map((t) => [t.type, t.at])).toEqual([
      ["replied", "2026-10-20T11:00:00.000Z"],
      ["click", "2026-10-20T10:00:00.000Z"],
      ["click", "2026-10-20T09:00:00.000Z"],
      ["click", "2026-10-20T08:00:00.000Z"],
      ["sent", "2026-10-20T07:00:00.000Z"],
    ]);
  });
});

describe("emails stored before Phase 10 (no tokens / wrongLinks / reply fields)", () => {
  it("still list and show in the timeline", async () => {
    const c = await contact();
    // Written the old way, straight into the collection, without the fields added later.
    await TrackedEmail.collection.insertOne({
      inboxId: c._id,
      inboxEmail: "sales@tryracko.in",
      source: "manual",
      internetMessageId: "<old@x>",
      subject: "Old email",
      to: ["priya@client.com"],
      cc: [],
      bcc: [],
      recipients: ["priya@client.com"],
      contactIds: [c._id],
      sentAt: new Date("2026-10-10T05:00:00Z"),
    });
    const page = await listTrackedEmails(listTrackedEmailsQuerySchema.parse({}));
    expect(page.data[0]).toMatchObject({
      subject: "Old email",
      clicks: { total: 0, real: 0 },
      wrongLinks: [],
      repliedAt: null,
    });
    expect(await getContactTimeline(String(c._id))).toMatchObject([
      { type: "sent", subject: "Old email", wrongLink: false },
    ]);
  });
});

describe("trackingConfig", () => {
  it("says links only work on this computer while the base address is localhost", async () => {
    expect(await trackingConfig()).toMatchObject({
      baseUrl: "http://localhost:3000",
      isLocal: true,
      homepage: "https://racko.ai",
      allowedHosts: ["racko.ai", "www.racko.ai"],
      domains: [],
    });
  });

  it("lists only (non-deleted) domains with a tracking address", async () => {
    const withHost = await Domain.create({ name: "getracko.ai", trackingHost: "go.getracko.ai" });
    await Domain.create({ name: "userako.in" });
    await Domain.create({
      name: "old.in",
      trackingHost: "go.old.in",
      deletedAt: new Date(),
    });
    expect((await trackingConfig()).domains).toEqual([
      { id: String(withHost._id), name: "getracko.ai", trackingHost: "go.getracko.ai" },
    ]);
  });
});
