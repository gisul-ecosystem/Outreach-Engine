import { Types } from "mongoose";
import Papa from "papaparse";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Contact, LinkClick, List, TrackedEmail, TrackedLink } from "@/server/db/models";
import {
  getContactTimeline,
  getOrCreateLink,
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
    await expect(listLinksCsv(String(list._id), "https://evil.com")).rejects.toMatchObject({
      status: 400,
    });
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
  it("says links only work on this computer while the base address is localhost", () => {
    expect(trackingConfig()).toMatchObject({
      baseUrl: "http://localhost:3000",
      isLocal: true,
      homepage: "https://racko.ai",
      allowedHosts: ["racko.ai", "www.racko.ai"],
    });
  });
});
