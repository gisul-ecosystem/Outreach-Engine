import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Contact, LinkClick, TrackedEmail, TrackedLink } from "@/server/db/models";
import { rebuildAllEngagement } from "@/server/services/engagement.service";
import type { ClickVerdict } from "@/shared/enums";
import { clearMemoryDb, startMemoryDb, stopMemoryDb } from "../../helpers/memory-db";

beforeAll(startMemoryDb);
afterAll(stopMemoryDb);
beforeEach(clearMemoryDb);

const at = (iso: string) => new Date(iso);

describe("rebuildAllEngagement (npm run tracking:rebuild)", () => {
  it("recounts every contact's emailed / replied / clicked and every link's counters", async () => {
    const [priya, rahul, quiet] = await Contact.create([
      { email: "priya@x.com" },
      { email: "rahul@x.com" },
      { email: "quiet@x.com", engagement: { emailsSent: 99, realClickCount: 5 } }, // stale numbers
    ]);
    const email = (contactIds: Types.ObjectId[], sentAt: string, reply?: [string, string]) => ({
      inboxId: new Types.ObjectId(),
      inboxEmail: "sales@tryracko.in",
      source: "manual" as const,
      internetMessageId: `<${new Types.ObjectId()}@x>`,
      contactIds,
      sentAt: at(sentAt),
      repliedAt: reply ? at(reply[0]) : null,
      replyFromEmail: reply?.[1] ?? null,
    });
    await TrackedEmail.create([
      email([priya._id], "2026-10-01T05:00:00Z", ["2026-10-01T09:00:00Z", "priya@x.com"]),
      email([priya._id, rahul._id], "2026-10-05T05:00:00Z", [
        "2026-10-05T07:00:00Z",
        "rahul@x.com",
      ]),
    ]);
    const link = await TrackedLink.create({
      token: "PriyaToken01",
      contactId: priya._id,
      destinationUrl: "https://racko.ai/",
      clickCount: 42, // stale
    });
    const click = (verdict: ClickVerdict, iso: string) => ({
      linkId: link._id,
      token: link.token,
      contactId: priya._id,
      at: at(iso),
      method: "GET",
      verdict,
    });
    await LinkClick.create([
      click("bot", "2026-10-05T05:00:03Z"),
      click("click", "2026-10-06T10:00:00Z"),
      click("click", "2026-10-07T10:00:00Z"),
    ]);

    expect(await rebuildAllEngagement()).toEqual({ contacts: 3, links: 1 });

    const get = async (id: Types.ObjectId) => (await Contact.findById(id).lean())!.engagement;
    expect(await get(priya._id)).toMatchObject({
      emailsSent: 2,
      lastEmailedAt: at("2026-10-05T05:00:00Z"),
      replyCount: 1, // rahul answered the shared email, not priya
      lastRepliedAt: at("2026-10-01T09:00:00Z"),
      clickCount: 3,
      realClickCount: 2,
      lastClickedAt: at("2026-10-07T10:00:00Z"),
    });
    expect(await get(rahul._id)).toMatchObject({ emailsSent: 1, replyCount: 1, clickCount: 0 });
    expect(await get(quiet._id)).toMatchObject({ emailsSent: 0, realClickCount: 0 });
    expect(await TrackedLink.findById(link._id).lean()).toMatchObject({
      clickCount: 3,
      realClickCount: 2,
      firstRealClickAt: at("2026-10-06T10:00:00Z"),
      lastClickAt: at("2026-10-07T10:00:00Z"),
    });
  });
});
