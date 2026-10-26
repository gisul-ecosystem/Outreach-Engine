// Keeps the per-person summary on each contact (`engagement`: emailed / replied / clicked) and the
// counters on each tracking link in step with trackedEmails and linkClicks. Everything is RE-COUNTED
// from those collections (never +1/-1 guesses), so calling these again is always safe.
// `npm run tracking:rebuild` runs rebuildAllEngagement().
import { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Contact, LinkClick, TrackedEmail, TrackedLink } from "@/server/db/models";

const BATCH = 500;

type Engagement = {
  emailsSent: number;
  lastEmailedAt: Date | null;
  replyCount: number;
  lastRepliedAt: Date | null;
  clickCount: number;
  realClickCount: number;
  lastClickedAt: Date | null;
};

const later = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Re-counts `engagement` for these contacts. */
export async function refreshEngagement(contactIds: (Types.ObjectId | string)[]): Promise<void> {
  const ids = [...new Set(contactIds.map(String))].map((id) => new Types.ObjectId(id));
  if (ids.length === 0) return;
  for (let i = 0; i < ids.length; i += BATCH) await refreshBatch(ids.slice(i, i + BATCH));
}

async function refreshBatch(ids: Types.ObjectId[]) {
  const [contacts, emails, clicks] = await Promise.all([
    Contact.find({ _id: { $in: ids } })
      .select("email")
      .lean(),
    TrackedEmail.find({ contactIds: { $in: ids } })
      .select("contactIds sentAt repliedAt replyFromEmail")
      .lean(),
    LinkClick.aggregate<{
      _id: Types.ObjectId;
      clickCount: number;
      realClickCount: number;
      lastClickedAt: Date | null;
    }>([
      { $match: { contactId: { $in: ids } } },
      {
        $group: {
          _id: "$contactId",
          clickCount: { $sum: 1 },
          realClickCount: { $sum: { $cond: [{ $eq: ["$verdict", "click"] }, 1, 0] } },
          lastClickedAt: { $max: { $cond: [{ $eq: ["$verdict", "click"] }, "$at", null] } },
        },
      },
    ]),
  ]);
  const emailOf = new Map(contacts.map((c) => [String(c._id), c.email]));
  const result = new Map<string, Engagement>(
    ids.map((id) => [
      String(id),
      {
        emailsSent: 0,
        lastEmailedAt: null,
        replyCount: 0,
        lastRepliedAt: null,
        clickCount: 0,
        realClickCount: 0,
        lastClickedAt: null,
      },
    ]),
  );

  for (const email of emails) {
    const owners = email.contactIds.map(String).filter((id) => result.has(id));
    // A reply counts for the person who wrote it; a reply from someone else in the thread (e.g. a
    // colleague) counts for every contact the email went to.
    const replier = owners.find((id) => emailOf.get(id) === email.replyFromEmail);
    for (const id of owners) {
      const e = result.get(id)!;
      e.emailsSent++;
      e.lastEmailedAt = later(e.lastEmailedAt, email.sentAt);
      if (email.repliedAt && (!replier || replier === id)) {
        e.replyCount++;
        e.lastRepliedAt = later(e.lastRepliedAt, email.repliedAt);
      }
    }
  }
  for (const row of clicks) {
    const e = result.get(String(row._id));
    if (!e) continue;
    e.clickCount = row.clickCount;
    e.realClickCount = row.realClickCount;
    e.lastClickedAt = row.lastClickedAt;
  }

  await Contact.bulkWrite(
    [...result].map(([id, engagement]) => ({
      updateOne: { filter: { _id: new Types.ObjectId(id) }, update: { $set: { engagement } } },
    })),
    { ordered: false },
  );
}

/** Re-counts clickCount / realClickCount / firstRealClickAt / lastClickAt on these links. */
export async function refreshLinkCounters(linkIds: (Types.ObjectId | string)[]): Promise<void> {
  const ids = [...new Set(linkIds.map(String))].map((id) => new Types.ObjectId(id));
  if (ids.length === 0) return;
  const rows = await LinkClick.aggregate<{
    _id: Types.ObjectId;
    clickCount: number;
    realClickCount: number;
    firstRealClickAt: Date | null;
    lastClickAt: Date | null;
  }>([
    { $match: { linkId: { $in: ids } } },
    {
      $group: {
        _id: "$linkId",
        clickCount: { $sum: 1 },
        realClickCount: { $sum: { $cond: [{ $eq: ["$verdict", "click"] }, 1, 0] } },
        firstRealClickAt: { $min: { $cond: [{ $eq: ["$verdict", "click"] }, "$at", null] } },
        lastClickAt: { $max: "$at" },
      },
    },
  ]);
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  await TrackedLink.bulkWrite(
    ids.map((id) => {
      const r = byId.get(String(id));
      return {
        updateOne: {
          filter: { _id: id },
          update: {
            $set: {
              clickCount: r?.clickCount ?? 0,
              realClickCount: r?.realClickCount ?? 0,
              firstRealClickAt: r?.firstRealClickAt ?? null,
              lastClickAt: r?.lastClickAt ?? null,
            },
          },
        },
      };
    }),
    { ordered: false },
  );
}

/** Recalculates every contact's engagement and every link's counters (`npm run tracking:rebuild`). */
export async function rebuildAllEngagement(): Promise<{ contacts: number; links: number }> {
  await connectDB();
  let contacts = 0;
  let links = 0;
  let batch: Types.ObjectId[] = [];
  for await (const c of Contact.find().select("_id").lean().cursor()) {
    batch.push(c._id);
    if (batch.length === BATCH) {
      await refreshEngagement(batch);
      contacts += batch.length;
      batch = [];
    }
  }
  await refreshEngagement(batch);
  contacts += batch.length;

  batch = [];
  for await (const l of TrackedLink.find().select("_id").lean().cursor()) {
    batch.push(l._id);
    if (batch.length === BATCH) {
      await refreshLinkCounters(batch);
      links += batch.length;
      batch = [];
    }
  }
  await refreshLinkCounters(batch);
  links += batch.length;
  return { contacts, links };
}
