// Emails found in the inboxes' Sent Items folders (stored by the Sent Items tick): the list, and
// counts per day / week / month in the app timezone. Every query uses a trackedEmails index on sentAt.
import { DateTime, type DateTimeUnit } from "luxon";
import { Types, type PipelineStage } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Contact, Inbox, LinkClick, TrackedEmail } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { getTimezone } from "@/server/services/settings.service";
import type { Paginated } from "@/shared/common";
import type { TrackedEmailSource } from "@/shared/enums";
import type {
  ListTrackedEmailsQuery,
  SentCountDTO,
  TrackedEmailDTO,
  TrackedSourceFilter,
  TrackedStatsDTO,
  TrackedStatsQuery,
} from "@/shared/tracked-email";

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function baseFilter(query: { source: TrackedSourceFilter; inboxId?: string }) {
  const filter: Record<string, unknown> = {};
  if (query.source !== "all") filter.source = query.source;
  if (query.inboxId) filter.inboxId = new Types.ObjectId(query.inboxId);
  return filter;
}

/** Groups emails by `_id` → number of emails + number of DIFFERENT people they went to. */
function countStages(_id: unknown): PipelineStage[] {
  return [
    { $group: { _id, emails: { $sum: 1 }, lists: { $push: "$recipients" } } },
    {
      $project: {
        emails: 1,
        people: {
          $size: {
            $reduce: {
              input: "$lists",
              initialValue: [],
              in: { $setUnion: ["$$value", "$$this"] },
            },
          },
        },
      },
    },
  ];
}

async function countSince(filter: Record<string, unknown>, from: Date): Promise<SentCountDTO> {
  const [row] = await TrackedEmail.aggregate<SentCountDTO>([
    { $match: { ...filter, sentAt: { $gte: from } } },
    ...countStages(null),
  ]);
  return { emails: row?.emails ?? 0, people: row?.people ?? 0 };
}

export async function getTrackedStats(
  query: TrackedStatsQuery,
  now = new Date(),
): Promise<TrackedStatsDTO> {
  await connectDB();
  const tz = await getTimezone();
  const filter = baseFilter(query);
  const local = DateTime.fromJSDate(now, { zone: tz });
  const unit: DateTimeUnit = query.period;
  const current = local.startOf(unit); // luxon weeks start on Monday
  const first = current.minus({ [`${unit}s`]: query.count - 1 });

  const [today, thisWeek, thisMonth, rows, inboxes, wrongLinkEmails] = await Promise.all([
    countSince(filter, local.startOf("day").toJSDate()),
    countSince(filter, local.startOf("week").toJSDate()),
    countSince(filter, local.startOf("month").toJSDate()),
    TrackedEmail.aggregate<{ _id: Date; emails: number; people: number }>([
      { $match: { ...filter, sentAt: { $gte: first.toJSDate() } } },
      ...countStages({
        $dateTrunc: {
          date: "$sentAt",
          unit,
          timezone: tz,
          ...(unit === "week" ? { startOfWeek: "monday" } : {}),
        },
      }),
    ]),
    Inbox.find(notDeleted({ providerConnectionId: { $ne: null } }))
      .select("email sentItemsCheckedAt")
      .sort({ email: 1 })
      .lean(),
    TrackedEmail.countDocuments({ "wrongLinks.0": { $exists: true } }),
  ]);

  const key = (d: DateTime) => d.toFormat("yyyy-MM-dd");
  const byStart = new Map(
    rows.map((r) => [key(DateTime.fromJSDate(r._id, { zone: tz })), r] as const),
  );
  const label = (d: DateTime) =>
    unit === "month"
      ? d.toFormat("LLL yyyy")
      : unit === "week"
        ? `Week of ${d.toFormat("d LLL")}`
        : d.toFormat("ccc d LLL");

  const buckets = Array.from({ length: query.count }, (_, i) => {
    const start = first.plus({ [`${unit}s`]: i });
    const row = byStart.get(key(start));
    return {
      label: label(start),
      from: start.toUTC().toISO()!,
      to: start
        .plus({ [`${unit}s`]: 1 })
        .toUTC()
        .toISO()!,
      emails: row?.emails ?? 0,
      people: row?.people ?? 0,
    };
  });

  return {
    timezone: tz,
    today,
    thisWeek,
    thisMonth,
    buckets,
    wrongLinkEmails,
    inboxes: inboxes.map((i) => ({
      id: String(i._id),
      email: i.email,
      checkedAt: i.sentItemsCheckedAt ? i.sentItemsCheckedAt.toISOString() : null,
    })),
  };
}

export async function listTrackedEmails(
  query: ListTrackedEmailsQuery,
): Promise<Paginated<TrackedEmailDTO>> {
  await connectDB();
  const filter = baseFilter(query);
  if (query.from || query.to) {
    filter.sentAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lt: query.to } : {}),
    };
  }
  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: "i" };
    filter.$or = [{ recipients: pattern }, { subject: pattern }];
  }
  if (query.wrongLinksOnly) filter["wrongLinks.0"] = { $exists: true };

  const [found, total] = await Promise.all([
    TrackedEmail.find(filter)
      .sort({ sentAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    TrackedEmail.countDocuments(filter),
  ]);
  // Emails stored before a field existed don't have it (lean() skips schema defaults).
  const rows = found.map((r) => ({
    ...r,
    to: r.to ?? [],
    cc: r.cc ?? [],
    bcc: r.bcc ?? [],
    contactIds: r.contactIds ?? [],
    tokens: r.tokens ?? [],
    wrongLinks: r.wrongLinks ?? [],
  }));
  const [contacts, clickRows] = await Promise.all([
    Contact.find({
      _id: { $in: rows.flatMap((r) => [...r.contactIds, ...r.wrongLinks.map((w) => w.contactId)]) },
    })
      .select("email firstName lastName")
      .lean(),
    LinkClick.aggregate<{ _id: string; total: number; real: number }>([
      { $match: { token: { $in: rows.flatMap((r) => r.tokens) } } },
      {
        $group: {
          _id: "$token",
          total: { $sum: 1 },
          real: { $sum: { $cond: [{ $eq: ["$verdict", "click"] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const contactById = new Map(contacts.map((c) => [String(c._id), c]));
  const nameOf = (c: { firstName?: string | null; lastName?: string | null }) =>
    [c.firstName, c.lastName].filter(Boolean).join(" ");
  const clicksByToken = new Map(clickRows.map((r) => [r._id, r]));

  return {
    data: rows.map((r) => ({
      id: String(r._id),
      inboxEmail: r.inboxEmail,
      source: r.source as TrackedEmailSource,
      subject: r.subject ?? "",
      to: r.to,
      cc: r.cc,
      bcc: r.bcc,
      contacts: r.contactIds.flatMap((id) => {
        const c = contactById.get(String(id));
        return c ? [{ id: String(c._id), email: c.email, name: nameOf(c) }] : [];
      }),
      sentAt: r.sentAt.toISOString(),
      repliedAt: r.repliedAt ? r.repliedAt.toISOString() : null,
      replyFromEmail: r.replyFromEmail ?? null,
      clicks: r.tokens.reduce(
        (sum, token) => ({
          total: sum.total + (clicksByToken.get(token)?.total ?? 0),
          real: sum.real + (clicksByToken.get(token)?.real ?? 0),
        }),
        { total: 0, real: 0 },
      ),
      wrongLinks: r.wrongLinks.map((w) => {
        const owner = contactById.get(String(w.contactId));
        return {
          token: w.token,
          ownerEmail: owner?.email ?? "",
          ownerName: owner ? nameOf(owner) : "",
        };
      }),
    })),
    page: query.page,
    limit: query.limit,
    total,
  };
}
