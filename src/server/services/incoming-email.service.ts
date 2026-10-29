// The Inbox page: emails that arrived in the attached inboxes (stored by the Sent Items tick).
import { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Campaign, Contact, IncomingEmail, Inbox, type IncomingEmailDoc } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { ApiError } from "@/server/lib/errors";
import { READABLE_INBOX } from "@/server/scheduler/mailbox";
import { INCOMING_EMAIL_KINDS, type IncomingEmailKind } from "@/shared/enums";
import type {
  IncomingEmailDTO,
  IncomingEmailDetailDTO,
  IncomingEmailsPageDTO,
  IncomingKindFilter,
  ListIncomingEmailsQuery,
} from "@/shared/incoming-email";

type IncomingRecord = IncomingEmailDoc & { _id: Types.ObjectId };

const PREVIEW_LENGTH = 200;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Campaign and contact names for a set of emails (2 queries, not one per email). */
async function loadNames(rows: IncomingRecord[]) {
  const [campaigns, contacts] = await Promise.all([
    Campaign.find({
      _id: { $in: rows.flatMap((r) => (r.campaignId ? [r.campaignId] : [])) },
    })
      .select("name")
      .lean(),
    Contact.find({
      _id: { $in: rows.flatMap((r) => (r.contactId ? [r.contactId] : [])) },
    })
      .select("email firstName lastName")
      .lean(),
  ]);
  return {
    campaigns: new Map(campaigns.map((c) => [String(c._id), c])),
    contacts: new Map(contacts.map((c) => [String(c._id), c])),
  };
}

function toDTO(r: IncomingRecord, names: Awaited<ReturnType<typeof loadNames>>): IncomingEmailDTO {
  const campaign = r.campaignId ? names.campaigns.get(String(r.campaignId)) : undefined;
  const contact = r.contactId ? names.contacts.get(String(r.contactId)) : undefined;
  const text = (r.text || r.body || "").replace(/\s+/g, " ").trim();
  return {
    id: String(r._id),
    inboxId: String(r.inboxId),
    inboxEmail: r.inboxEmail,
    kind: r.kind as IncomingEmailKind,
    fromEmail: r.fromEmail ?? "",
    fromName: r.fromName ?? "",
    subject: r.subject ?? "",
    preview: text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text,
    receivedAt: r.receivedAt.toISOString(),
    campaign: campaign ? { id: String(campaign._id), name: campaign.name } : null,
    contact: contact
      ? {
          id: String(contact._id),
          email: contact.email,
          name: [contact.firstName, contact.lastName].filter(Boolean).join(" "),
        }
      : null,
  };
}

export async function listIncomingEmails(
  query: ListIncomingEmailsQuery,
): Promise<IncomingEmailsPageDTO> {
  await connectDB();
  const base: Record<string, unknown> = {};
  if (query.inboxId) base.inboxId = new Types.ObjectId(query.inboxId);
  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: "i" };
    base.$or = [{ fromEmail: pattern }, { fromName: pattern }, { subject: pattern }];
  }
  const filter = query.kind === "all" ? base : { ...base, kind: query.kind };

  const [rows, total, kindRows, inboxes] = await Promise.all([
    IncomingEmail.find(filter)
      .select("-body")
      .sort({ receivedAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<IncomingRecord[]>(),
    IncomingEmail.countDocuments(filter),
    IncomingEmail.aggregate<{ _id: IncomingEmailKind; count: number }>([
      { $match: base },
      { $group: { _id: "$kind", count: { $sum: 1 } } },
    ]),
    Inbox.find(notDeleted(READABLE_INBOX))
      .select("email incomingCheckedAt")
      .sort({ email: 1 })
      .lean(),
  ]);

  const counts = Object.fromEntries([...INCOMING_EMAIL_KINDS, "all"].map((k) => [k, 0])) as Record<
    IncomingKindFilter,
    number
  >;
  for (const row of kindRows) {
    counts[row._id] = row.count;
    counts.all += row.count;
  }
  const names = await loadNames(rows);
  return {
    data: rows.map((r) => toDTO(r, names)),
    page: query.page,
    limit: query.limit,
    total,
    counts,
    inboxes: inboxes.map((i) => ({
      id: String(i._id),
      email: i.email,
      checkedAt: i.incomingCheckedAt ? i.incomingCheckedAt.toISOString() : null,
    })),
  };
}

export async function getIncomingEmail(id: string): Promise<IncomingEmailDetailDTO> {
  await connectDB();
  const row = await IncomingEmail.findById(id).lean<IncomingRecord>();
  if (!row) throw new ApiError(404, "EMAIL_NOT_FOUND", "Email not found");
  return {
    ...toDTO(row, await loadNames([row])),
    text: row.text ?? "",
    body: row.body ?? "",
  };
}
