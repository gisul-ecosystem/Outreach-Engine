// Tracking links for hand-written emails: one link per contact per destination (reused when copied
// again; "new" makes a fresh one), the CSV of a list's links, the click list and a contact's timeline.
import Papa from "papaparse";
import { Types } from "mongoose";
import { getEnv } from "@/server/config/env";
import { connectDB } from "@/server/db/connect";
import { Contact, LinkClick, TrackedEmail, TrackedLink } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { ApiError } from "@/server/lib/errors";
import { findContactOr404 } from "@/server/services/contact.service";
import { findListOr404 } from "@/server/services/list.service";
import { allowedDestination } from "@/server/tracking/destination";
import { linkUrl, newToken } from "@/server/tracking/token";
import type { Paginated } from "@/shared/common";
import type { ClickVerdict, TrackedEmailSource } from "@/shared/enums";
import type {
  ClickFilter,
  LinkClickDTO,
  ListClicksQuery,
  TimelineItemDTO,
  TrackedLinkDTO,
  TrackingConfigDTO,
} from "@/shared/tracking";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const fullName = (c: { firstName?: string | null; lastName?: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(" ");

type LinkRecord = {
  _id: Types.ObjectId;
  token: string;
  destinationUrl: string;
  label?: string | null;
  sentEmailIds: Types.ObjectId[];
  firstSentAt?: Date | null;
  lastSentAt?: Date | null;
  clickCount: number;
  realClickCount: number;
  firstRealClickAt?: Date | null;
  lastClickAt?: Date | null;
  createdAt: Date;
};

export function trackingConfig(): TrackingConfigDTO {
  const env = getEnv();
  const base = new URL(env.TRACKING_BASE_URL);
  return {
    baseUrl: env.TRACKING_BASE_URL.replace(/\/+$/, ""),
    isLocal:
      base.protocol !== "https:" ||
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(base.hostname),
    homepage: env.TRACKING_FALLBACK_URL,
    allowedHosts: env.TRACKING_ALLOWED_HOSTS,
  };
}

function toDTO(link: LinkRecord): TrackedLinkDTO {
  return {
    id: String(link._id),
    token: link.token,
    url: linkUrl(getEnv().TRACKING_BASE_URL, link.token),
    destinationUrl: link.destinationUrl,
    label: link.label ?? "",
    createdAt: link.createdAt.toISOString(),
    sentCount: link.sentEmailIds.length,
    firstSentAt: iso(link.firstSentAt),
    lastSentAt: iso(link.lastSentAt),
    clickCount: link.clickCount,
    realClickCount: link.realClickCount,
    firstRealClickAt: iso(link.firstRealClickAt),
    lastClickAt: iso(link.lastClickAt),
  };
}

/** The cleaned destination, or a 400 when it is not https or not on TRACKING_ALLOWED_HOSTS. */
function checkedDestination(url: string): string {
  const env = getEnv();
  const destination = allowedDestination(url, env.TRACKING_ALLOWED_HOSTS);
  if (!destination) {
    throw new ApiError(
      400,
      "DESTINATION_NOT_ALLOWED",
      `Links can only lead to https addresses on ${env.TRACKING_ALLOWED_HOSTS.join(", ")} (TRACKING_ALLOWED_HOSTS).`,
    );
  }
  return destination;
}

/** The contact's newest link to this destination, or a new one (always new when `fresh`). */
export async function getOrCreateLink(
  contactId: string,
  input: { destinationUrl: string; label: string; new: boolean },
): Promise<TrackedLinkDTO> {
  await connectDB();
  const contact = await findContactOr404(contactId);
  const destinationUrl = checkedDestination(input.destinationUrl);

  if (!input.new) {
    const existing = await TrackedLink.findOne({
      contactId: contact._id,
      destinationUrl,
      deletedAt: null,
    })
      .sort({ createdAt: -1 })
      .lean<LinkRecord>();
    if (existing) {
      // The words can change between copies; the link itself stays the same.
      if (input.label && input.label !== existing.label) {
        await TrackedLink.updateOne({ _id: existing._id }, { $set: { label: input.label } });
        existing.label = input.label;
      }
      return toDTO(existing);
    }
  }
  const created = await TrackedLink.create({
    token: newToken(),
    contactId: contact._id,
    destinationUrl,
    label: input.label,
  });
  return toDTO(created.toObject() as LinkRecord);
}

export async function listContactLinks(contactId: string): Promise<TrackedLinkDTO[]> {
  await connectDB();
  const contact = await findContactOr404(contactId);
  const links = await TrackedLink.find({ contactId: contact._id, deletedAt: null })
    .sort({ createdAt: -1 })
    .lean<LinkRecord[]>();
  return links.map(toDTO);
}

/**
 * CSV with one link per contact of the list (email, name, company, status, link), creating the
 * missing ones. Cells starting with = + - @ are escaped so a spreadsheet never runs them as formulas.
 */
export async function listLinksCsv(
  listId: string,
  destinationUrl?: string,
): Promise<{ filename: string; csv: string }> {
  await connectDB();
  const list = await findListOr404(listId);
  const destination = checkedDestination(destinationUrl ?? getEnv().TRACKING_FALLBACK_URL);
  const contacts = await Contact.find(notDeleted({ listIds: list._id }))
    .select("email firstName lastName company status")
    .sort({ email: 1 })
    .lean();

  const ids = contacts.map((c) => c._id);
  const existing = await TrackedLink.find({
    contactId: { $in: ids },
    destinationUrl: destination,
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .select("contactId token")
    .lean();
  const tokenOf = new Map<string, string>();
  for (const link of existing) {
    if (!tokenOf.has(String(link.contactId))) tokenOf.set(String(link.contactId), link.token);
  }
  const missing = contacts.filter((c) => !tokenOf.has(String(c._id)));
  if (missing.length) {
    const docs = missing.map((c) => ({
      token: newToken(),
      contactId: c._id,
      destinationUrl: destination,
      label: "",
    }));
    await TrackedLink.insertMany(docs, { ordered: false });
    for (const d of docs) tokenOf.set(String(d.contactId), d.token);
  }

  const base = getEnv().TRACKING_BASE_URL;
  const csv = Papa.unparse(
    contacts.map((c) => ({
      email: c.email,
      first_name: c.firstName ?? "",
      last_name: c.lastName ?? "",
      company: c.company ?? "",
      status: c.status,
      link: linkUrl(base, tokenOf.get(String(c._id))!),
    })),
    {
      columns: ["email", "first_name", "last_name", "company", "status", "link"],
      escapeFormulae: true,
    },
  );
  const slug =
    list.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "list";
  return { filename: `links-${slug}.csv`, csv };
}

const VERDICTS_FOR: Record<ClickFilter, ClickVerdict[]> = {
  real: ["click"],
  "real-and-maybe": ["click", "suspicious"],
  all: ["click", "suspicious", "bot"],
};

export async function listClicks(query: ListClicksQuery): Promise<Paginated<LinkClickDTO>> {
  await connectDB();
  const filter: Record<string, unknown> = { verdict: { $in: VERDICTS_FOR[query.include] } };
  if (query.from || query.to) {
    filter.at = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lt: query.to } : {}),
    };
  }
  if (query.contactId) filter.contactId = new Types.ObjectId(query.contactId);
  if (query.inboxId) {
    filter.token = {
      $in: await TrackedEmail.distinct("tokens", { inboxId: new Types.ObjectId(query.inboxId) }),
    };
  }

  const [rows, total] = await Promise.all([
    LinkClick.find(filter)
      .sort({ at: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
    LinkClick.countDocuments(filter),
  ]);
  const [contacts, links] = await Promise.all([
    Contact.find({ _id: { $in: rows.map((r) => r.contactId) } })
      .select("email firstName lastName")
      .lean(),
    TrackedLink.find({ _id: { $in: rows.map((r) => r.linkId) } })
      .select("destinationUrl")
      .lean(),
  ]);
  const contactById = new Map(contacts.map((c) => [String(c._id), c]));
  const destinationById = new Map(links.map((l) => [String(l._id), l.destinationUrl]));

  return {
    data: rows.map((r) => {
      const c = contactById.get(String(r.contactId));
      return {
        id: String(r._id),
        at: r.at.toISOString(),
        verdict: r.verdict as ClickVerdict,
        reasons: r.reasons,
        method: r.method,
        userAgent: r.userAgent ?? "",
        destinationUrl: destinationById.get(String(r.linkId)) ?? "",
        contact: c ? { id: String(c._id), email: c.email, name: fullName(c) } : null,
      };
    }),
    page: query.page,
    limit: query.limit,
    total,
  };
}

const TIMELINE_LIMIT = 200;

/** Everything that happened with one person, newest first: emails sent, replies, link clicks. */
export async function getContactTimeline(contactId: string): Promise<TimelineItemDTO[]> {
  await connectDB();
  const contact = await findContactOr404(contactId);
  const [emails, clicks] = await Promise.all([
    TrackedEmail.find({ contactIds: contact._id })
      .sort({ sentAt: -1 })
      .limit(TIMELINE_LIMIT)
      .lean(),
    LinkClick.find({ contactId: contact._id }).sort({ at: -1 }).limit(TIMELINE_LIMIT).lean(),
  ]);
  const destinations = new Map(
    (
      await TrackedLink.find({ _id: { $in: clicks.map((c) => c.linkId) } })
        .select("destinationUrl")
        .lean()
    ).map((l) => [String(l._id), l.destinationUrl]),
  );

  const items: TimelineItemDTO[] = [];
  for (const e of emails) {
    items.push({
      type: "sent",
      at: e.sentAt.toISOString(),
      subject: e.subject ?? "",
      inboxEmail: e.inboxEmail,
      source: e.source as TrackedEmailSource,
      // Emails stored before wrong-link checks existed don't have the field.
      wrongLink: (e.wrongLinks ?? []).length > 0,
    });
    if (e.repliedAt) {
      items.push({
        type: "replied",
        at: e.repliedAt.toISOString(),
        subject: e.subject ?? "",
        from: e.replyFromEmail ?? "",
      });
    }
  }
  for (const c of clicks) {
    items.push({
      type: "click",
      at: c.at.toISOString(),
      verdict: c.verdict as ClickVerdict,
      reasons: c.reasons,
      destinationUrl: destinations.get(String(c.linkId)) ?? "",
    });
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
