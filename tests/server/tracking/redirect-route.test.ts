// The public tracking link /r/<token>: always a 302 to a safe place, the click saved with a verdict.
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "@/app/r/[token]/route";
import { Contact, LinkClick, TrackedLink } from "@/server/db/models";
import { resetRateLimit } from "@/server/tracking/rate-limit";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(async () => {
  await clearMemoryDb();
  resetRateLimit();
  vi.restoreAllMocks();
});

const BROWSER = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "accept-language": "en-IN,en;q=0.9",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "x-forwarded-for": "203.0.113.7",
};

async function open(
  token: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) {
  const request = new NextRequest(`http://localhost:3000/r/${token}`, {
    method: init.method ?? "GET",
    headers: init.headers ?? BROWSER,
  });
  const handler = request.method === "HEAD" ? HEAD : GET;
  return handler(request, { params: Promise.resolve({ token }) });
}

async function makeLink(destinationUrl = "https://racko.ai/pricing") {
  const contact = await Contact.create({ email: "priya@client.com", firstName: "Priya" });
  const link = await TrackedLink.create({
    token: "k7f2Qa9xLm_3",
    contactId: contact._id,
    destinationUrl,
  });
  return { contact, link };
}

describe("GET /r/[token]", () => {
  it("redirects (302, no caching) to the destination and saves a real click", async () => {
    const { contact, link } = await makeLink();
    const res = await open(link.token);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://racko.ai/pricing");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");

    const click = await LinkClick.findOne().lean();
    expect(click).toMatchObject({
      token: link.token,
      method: "GET",
      verdict: "click",
      reasons: ["Looks like a real person."],
    });
    expect(String(click!.contactId)).toBe(String(contact._id));
    expect(await TrackedLink.findById(link._id).lean()).toMatchObject({
      clickCount: 1,
      realClickCount: 1,
    });
    // The contact's summary is updated just after the redirect.
    await vi.waitFor(async () =>
      expect((await Contact.findById(contact._id).lean())!.engagement).toMatchObject({
        realClickCount: 1,
        clickCount: 1,
      }),
    );
  });

  it("HEAD (e.g. curl -I) still redirects and is saved as a bot", async () => {
    const { link } = await makeLink();
    const res = await open(link.token, { method: "HEAD", headers: { "user-agent": "curl/8.9.1" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://racko.ai/pricing");
    expect(await LinkClick.findOne().lean()).toMatchObject({ method: "HEAD", verdict: "bot" });
    expect(await TrackedLink.findById(link._id).lean()).toMatchObject({
      clickCount: 1,
      realClickCount: 0,
    });
  });

  it.each(["AbCdEfGhIjKl", "bad", "..%2F..%2Fadmin"])(
    "unknown or malformed token %s → racko.ai, nothing saved",
    async (token) => {
      const res = await open(token);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("https://racko.ai");
      expect(await LinkClick.countDocuments()).toBe(0);
    },
  );

  it("a deleted link → racko.ai", async () => {
    const { link } = await makeLink();
    await TrackedLink.updateOne({ _id: link._id }, { $set: { deletedAt: new Date() } });
    expect((await open(link.token)).headers.get("location")).toBe("https://racko.ai");
  });

  it("a database error → still redirected to racko.ai (no error page)", async () => {
    const { link } = await makeLink();
    vi.spyOn(TrackedLink, "findOne").mockImplementation(() => {
      throw new Error("connection refused");
    });
    const res = await open(link.token);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://racko.ai");
  });

  it("a database that hangs → redirected within the time limit", async () => {
    const { link } = await makeLink();
    vi.spyOn(TrackedLink, "findOne").mockImplementation(
      () =>
        ({ lean: () => new Promise(() => {}) }) as unknown as ReturnType<
          typeof TrackedLink.findOne
        >,
    );
    const started = Date.now();
    const res = await open(link.token);
    expect(res.headers.get("location")).toBe("https://racko.ai");
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("a link whose destination is not allowed is never followed", async () => {
    const contact = await Contact.create({ email: "x@client.com" });
    // Written straight into the database (the API would refuse it) — the redirect checks again.
    await TrackedLink.collection.insertOne({
      token: "EvilEvilEvil",
      contactId: contact._id,
      destinationUrl: "https://evil.com/login",
      deletedAt: null,
      sentEmailIds: [],
      clickCount: 0,
      realClickCount: 0,
    });
    const res = await open("EvilEvilEvil");
    expect(res.headers.get("location")).toBe("https://racko.ai");
  });

  it("never stores the raw IP address (only a scrambled code)", async () => {
    const { link } = await makeLink();
    await open(link.token);
    const click = await LinkClick.findOne().lean();
    expect(click!.ipHash).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    for (const name of await mongoose.connection.db!.listCollections().toArray()) {
      const docs = await mongoose.connection.db!.collection(name.name).find().toArray();
      expect(JSON.stringify(docs)).not.toContain("203.0.113.7");
    }
  });

  it("over the rate limit: still redirected, the click is not saved", async () => {
    const { link } = await makeLink();
    for (let i = 0; i < 31; i++) {
      expect((await open(link.token)).headers.get("location")).toBe("https://racko.ai/pricing");
    }
    expect(await LinkClick.countDocuments()).toBe(30);
  });

  it("a burst of opens from the same link is marked 'maybe a bot'", async () => {
    const { link } = await makeLink();
    for (let i = 0; i < 3; i++) await open(link.token);
    const last = await LinkClick.findOne().sort({ _id: -1 }).lean();
    expect(last).toMatchObject({ verdict: "suspicious", reasonCodes: ["burst"] });
  });
});
