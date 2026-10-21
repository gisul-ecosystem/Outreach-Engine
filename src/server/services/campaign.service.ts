import { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import {
  Campaign,
  Contact,
  Domain,
  Inbox,
  List,
  Message,
  Suppression,
  type CampaignDoc,
  type MessageDoc,
} from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { ApiError } from "@/server/lib/errors";
import { renderEmail, type TemplateContact } from "@/server/lib/template";
import { estimateFinishDate, isValidWindow, nextWindowStart } from "@/server/scheduler/time";
import { logEvent } from "@/server/services/event.service";
import { releaseScheduledMessages } from "@/server/services/queue.service";
import { getTimezone } from "@/server/services/settings.service";
import type {
  CampaignDTO,
  CampaignPreviewDTO,
  CampaignStatsDTO,
  MessageCounts,
  MessageDTO,
  StartCampaignResult,
} from "@/shared/campaign";
import type { Paginated } from "@/shared/common";
import { MESSAGE_STATUSES, type CampaignStatus, type MessageStatus } from "@/shared/enums";

type CampaignRecord = CampaignDoc & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
type MessageRecord = MessageDoc & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };
type SendWindow = { startMinute: number; endMinute: number; days: number[] };

/** Contacts are read and messages inserted in batches of this size. */
const BATCH = 1000;
const DUPLICATE_KEY = 11000;
/** Only draft and paused campaigns can be edited. */
const EDITABLE: CampaignStatus[] = ["draft", "paused"];

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function emptyCounts(): MessageCounts {
  return Object.fromEntries(MESSAGE_STATUSES.map((s) => [s, 0])) as MessageCounts;
}
const sumCounts = (c: MessageCounts) => Object.values(c).reduce((a, b) => a + b, 0);

function windowOf(campaign: CampaignRecord): SendWindow {
  const w = campaign.sendWindow;
  return {
    startMinute: w?.startMinute ?? 0,
    endMinute: w?.endMinute ?? 0,
    days: [...(w?.days ?? [])],
  };
}

function toDTO(c: CampaignRecord, listName: string | null, counts: MessageCounts): CampaignDTO {
  return {
    id: String(c._id),
    name: c.name,
    listId: String(c.listId),
    listName,
    inboxIds: (c.inboxIds ?? []).map(String),
    subjectTemplate: c.subjectTemplate ?? "",
    bodyTemplate: c.bodyTemplate ?? "",
    bodyHtml: c.bodyHtml ?? null,
    sendWindow: windowOf(c),
    status: c.status as CampaignStatus,
    startedAt: iso(c.startedAt),
    completedAt: iso(c.completedAt),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    counts,
    totalMessages: sumCounts(counts),
  };
}

/** Messages per status for each campaign (one aggregation, uses the { campaignId, status } index). */
async function countsFor(ids: Types.ObjectId[]): Promise<Map<string, MessageCounts>> {
  const rows = await Message.aggregate<{
    _id: { campaignId: Types.ObjectId; status: MessageStatus };
    n: number;
  }>([
    { $match: { campaignId: { $in: ids } } },
    { $group: { _id: { campaignId: "$campaignId", status: "$status" }, n: { $sum: 1 } } },
  ]);
  const result = new Map<string, MessageCounts>();
  for (const row of rows) {
    const key = String(row._id.campaignId);
    const counts = result.get(key) ?? emptyCounts();
    counts[row._id.status] = row.n;
    result.set(key, counts);
  }
  return result;
}

async function listNames(ids: Types.ObjectId[]) {
  const lists = await List.find({ _id: { $in: ids } })
    .select("name deletedAt")
    .lean();
  return new Map(lists.map((l) => [String(l._id), l.deletedAt ? `${l.name} (deleted)` : l.name]));
}

async function dto(campaign: CampaignRecord): Promise<CampaignDTO> {
  const [names, counts] = await Promise.all([
    listNames([campaign.listId as Types.ObjectId]),
    countsFor([campaign._id]),
  ]);
  return toDTO(
    campaign,
    names.get(String(campaign.listId)) ?? null,
    counts.get(String(campaign._id)) ?? emptyCounts(),
  );
}

async function findCampaignOr404(id: string): Promise<CampaignRecord> {
  const campaign = await Campaign.findOne(notDeleted({ _id: id })).lean<CampaignRecord>();
  if (!campaign) throw new ApiError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
  return campaign;
}

async function assertListExists(listId: string) {
  if (!(await List.exists(notDeleted({ _id: listId })))) {
    throw new ApiError(400, "INVALID_LIST", "listId: That list does not exist");
  }
}

async function assertInboxesExist(inboxIds: string[]) {
  if (inboxIds.length === 0) return;
  const found = await Inbox.countDocuments(notDeleted({ _id: { $in: inboxIds } }));
  if (found !== inboxIds.length) {
    throw new ApiError(400, "INVALID_INBOX", "inboxIds: One of the inboxes does not exist");
  }
}

function assertEditable(campaign: CampaignRecord) {
  if (!EDITABLE.includes(campaign.status as CampaignStatus)) {
    throw new ApiError(
      409,
      "CAMPAIGN_NOT_EDITABLE",
      campaign.status === "running"
        ? "Pause the campaign before editing it"
        : "A completed campaign cannot be edited",
    );
  }
}

/**
 * Inboxes of the campaign that can send: not deleted, status active, and their domain active (not deleted).
 * Their summed daily limits = how many emails per window day the campaign can send at most.
 */
async function usableInboxes(inboxIds: Types.ObjectId[]) {
  const inboxes = await Inbox.find(notDeleted({ _id: { $in: inboxIds }, status: "active" }))
    .select("domainId dailyLimit")
    .lean();
  const activeDomains = await Domain.find(
    notDeleted({ _id: { $in: inboxes.map((i) => i.domainId) }, status: "active" }),
  )
    .select("_id")
    .lean();
  const ok = new Set(activeDomains.map((d) => String(d._id)));
  const usable = inboxes.filter((i) => ok.has(String(i.domainId)));
  return { count: usable.length, dailyCapacity: usable.reduce((sum, i) => sum + i.dailyLimit, 0) };
}

/** Who in the list would get a message: active, not deleted and not on the suppression list. */
async function audienceOf(listId: Types.ObjectId) {
  const [row] = await Contact.aggregate<{ total: number; sendable: number }>([
    { $match: { listIds: listId, deletedAt: null } },
    {
      $lookup: {
        from: Suppression.collection.name,
        localField: "email",
        foreignField: "email",
        as: "suppressed",
        pipeline: [{ $project: { _id: 1 } }],
      },
    },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        sendable: {
          $sum: {
            $cond: [
              { $and: [{ $eq: ["$status", "active"] }, { $eq: [{ $size: "$suppressed" }, 0] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const total = row?.total ?? 0;
  const sendable = row?.sendable ?? 0;
  return { total, sendable, skipped: total - sendable };
}

// ---------- CRUD ----------

export async function listCampaigns(query: {
  page: number;
  limit: number;
  status?: CampaignStatus;
  search?: string;
}): Promise<Paginated<CampaignDTO>> {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.search) filter.name = { $regex: escapeRegex(query.search), $options: "i" };
  const [campaigns, total] = await Promise.all([
    Campaign.find(notDeleted(filter))
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<CampaignRecord[]>(),
    Campaign.countDocuments(notDeleted(filter)),
  ]);
  const [names, counts] = await Promise.all([
    listNames(campaigns.map((c) => c.listId as Types.ObjectId)),
    countsFor(campaigns.map((c) => c._id)),
  ]);
  return {
    data: campaigns.map((c) =>
      toDTO(c, names.get(String(c.listId)) ?? null, counts.get(String(c._id)) ?? emptyCounts()),
    ),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function getCampaign(id: string): Promise<CampaignDTO> {
  await connectDB();
  return dto(await findCampaignOr404(id));
}

export async function createCampaign(input: {
  name: string;
  listId: string;
  inboxIds: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  bodyHtml: string | null;
  sendWindow: SendWindow;
}): Promise<CampaignDTO> {
  await connectDB();
  await assertListExists(input.listId);
  await assertInboxesExist(input.inboxIds);
  const created = await Campaign.create({ ...input, status: "draft" });
  await logEvent("campaign.created", `Campaign "${input.name}" created`, {
    campaignId: created._id,
  });
  return getCampaign(String(created._id));
}

export async function updateCampaign(
  id: string,
  input: {
    name?: string;
    listId?: string;
    inboxIds?: string[];
    subjectTemplate?: string;
    bodyTemplate?: string;
    bodyHtml?: string | null;
    sendWindow?: SendWindow;
  },
): Promise<CampaignDTO> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  assertEditable(campaign);
  if (input.listId !== undefined && input.listId !== String(campaign.listId)) {
    if (campaign.status !== "draft") {
      throw new ApiError(
        409,
        "CAMPAIGN_LIST_LOCKED",
        "The list cannot be changed after the campaign has started",
      );
    }
    await assertListExists(input.listId);
  }
  if (input.inboxIds) await assertInboxesExist(input.inboxIds);

  const update = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  // Only update while still editable (protects against a Start/Resume happening at the same moment).
  const result = await Campaign.updateOne(
    { _id: campaign._id, status: { $in: EDITABLE } },
    { $set: update },
  );
  if (result.matchedCount === 0) assertEditable(await findCampaignOr404(id));
  return getCampaign(id);
}

/** Soft delete (messages and stats are kept). A running campaign must be paused first. */
export async function deleteCampaign(id: string): Promise<{ id: string }> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  if (campaign.status === "running") {
    throw new ApiError(409, "CAMPAIGN_RUNNING", "Pause the campaign before deleting it");
  }
  await releaseScheduledMessages({ campaignId: campaign._id });
  await Campaign.updateOne({ _id: campaign._id }, { $set: { deletedAt: new Date() } });
  await logEvent("campaign.deleted", `Campaign "${campaign.name}" deleted`, {
    campaignId: campaign._id,
  });
  return { id };
}

// ---------- preview ----------

/** custom.<key> names used by contacts of this list (looks at up to 1,000 contacts). */
async function customVariablesOf(listId: Types.ObjectId): Promise<string[]> {
  const rows = await Contact.aggregate<{ _id: string }>([
    { $match: { listIds: listId, deletedAt: null } },
    { $limit: BATCH },
    { $project: { kv: { $objectToArray: { $ifNull: ["$custom", {}] } } } },
    { $unwind: "$kv" },
    { $group: { _id: "$kv.k" } },
    { $sort: { _id: 1 } },
  ]);
  return rows.map((r) => `custom.${r._id}`);
}

export async function previewCampaign(
  id: string,
  input: {
    contactId?: string;
    subjectTemplate?: string;
    bodyTemplate?: string;
    bodyHtml?: string | null;
  },
): Promise<CampaignPreviewDTO> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  const listId = campaign.listId as Types.ObjectId;

  let contact: (TemplateContact & { _id: Types.ObjectId }) | null;
  if (input.contactId) {
    contact = await Contact.findOne(notDeleted({ _id: input.contactId, listIds: listId })).lean<
      TemplateContact & { _id: Types.ObjectId }
    >();
    if (!contact) {
      throw new ApiError(404, "CONTACT_NOT_FOUND", "That contact is not in this campaign's list");
    }
  } else {
    // The first active contact of the list (any contact if none is active).
    contact =
      (await Contact.findOne(notDeleted({ listIds: listId, status: "active" }))
        .sort({ createdAt: 1, _id: 1 })
        .lean<TemplateContact & { _id: Types.ObjectId }>()) ??
      (await Contact.findOne(notDeleted({ listIds: listId }))
        .sort({ createdAt: 1, _id: 1 })
        .lean<TemplateContact & { _id: Types.ObjectId }>());
  }

  const subjectTemplate = input.subjectTemplate ?? campaign.subjectTemplate ?? "";
  const bodyTemplate = input.bodyTemplate ?? campaign.bodyTemplate ?? "";
  const bodyHtml = input.bodyHtml !== undefined ? input.bodyHtml : (campaign.bodyHtml ?? null);
  const rendered = renderEmail(
    { subjectTemplate, bodyTemplate, bodyHtml },
    contact ?? { email: "someone@example.com" },
  );

  const warnings: string[] = [];
  if (!contact) warnings.push("This list has no contacts yet — the preview uses empty values.");
  if (!subjectTemplate.trim()) warnings.push("The subject is empty.");
  if (!bodyTemplate.trim()) warnings.push("The email body is empty.");
  warnings.push(...rendered.warnings);

  return {
    contact: contact
      ? {
          id: String(contact._id),
          email: contact.email,
          firstName: contact.firstName ?? "",
          lastName: contact.lastName ?? "",
          company: contact.company ?? "",
        }
      : null,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    warnings,
    customVariables: await customVariablesOf(listId),
  };
}

// ---------- start / pause / resume ----------

/**
 * insertMany(ordered: false): every document is tried; ones that already exist hit the unique index
 * { campaignId, contactId } and are ignored. Returns how many were really inserted.
 */
async function insertIgnoringDuplicates(docs: Record<string, unknown>[]): Promise<number> {
  if (docs.length === 0) return 0;
  try {
    return (await Message.insertMany(docs, { ordered: false })).length;
  } catch (err) {
    const e = err as {
      code?: number;
      writeErrors?: { code?: number; err?: { code?: number } }[];
      insertedDocs?: unknown[];
      result?: { insertedCount?: number };
    };
    const writeErrors = e.writeErrors ?? [];
    const onlyDuplicates =
      writeErrors.length > 0
        ? writeErrors.every((w) => (w.code ?? w.err?.code) === DUPLICATE_KEY)
        : e.code === DUPLICATE_KEY;
    if (!onlyDuplicates) throw err;
    return e.insertedDocs?.length ?? e.result?.insertedCount ?? 0;
  }
}

function skipReason(status: string, suppressed: boolean) {
  if (suppressed) return { code: "SUPPRESSED", message: "The email is on the suppression list" };
  if (status === "bounced") return { code: "BOUNCED", message: "The contact has bounced" };
  if (status !== "active") return { code: "UNSUBSCRIBED", message: "The contact unsubscribed" };
  return null;
}

/** One message per contact in the list: `pending`, or `skipped` (with the reason) if it must not be emailed. */
async function createMessages(campaign: CampaignRecord): Promise<number> {
  let created = 0;
  let batch: { _id: Types.ObjectId; email: string; status: string }[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const suppressed = new Set(
      (
        await Suppression.find({ email: { $in: batch.map((c) => c.email) } })
          .select("email")
          .lean()
      ).map((s) => s.email),
    );
    const docs = batch.map((c) => {
      const reason = skipReason(c.status, suppressed.has(c.email));
      return {
        campaignId: campaign._id,
        contactId: c._id,
        toEmail: c.email,
        status: reason ? "skipped" : "pending",
        error: reason,
      };
    });
    created += await insertIgnoringDuplicates(docs);
    batch = [];
  };

  const cursor = Contact.find(notDeleted({ listIds: campaign.listId }))
    .select("email status")
    .sort({ _id: 1 })
    .lean<{ _id: Types.ObjectId; email: string; status: string }[]>()
    .cursor({ batchSize: BATCH });
  for await (const contact of cursor) {
    batch.push(contact as unknown as { _id: Types.ObjectId; email: string; status: string });
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return created;
}

/** What is missing before a campaign can start (empty = ready). */
async function startProblems(campaign: CampaignRecord): Promise<string[]> {
  const problems: string[] = [];
  const listOk = await List.exists(notDeleted({ _id: campaign.listId }));
  if (!listOk) problems.push("The list was deleted — choose another list");
  if (!campaign.subjectTemplate?.trim()) problems.push("Write a subject");
  if (!campaign.bodyTemplate?.trim()) problems.push("Write the email body");
  if (!isValidWindow(windowOf(campaign))) problems.push("Choose at least one sending day");
  const { count } = await usableInboxes((campaign.inboxIds ?? []) as Types.ObjectId[]);
  if (count === 0) problems.push("Choose at least one active inbox (with an active domain)");
  if (listOk && (await audienceOf(campaign.listId as Types.ObjectId)).sendable === 0) {
    problems.push("No contact in this list can be emailed (empty, unsubscribed or suppressed)");
  }
  return problems;
}

/**
 * Start: validate, create one `pending` message per active contact (suppressed/unsubscribed/bounced → `skipped`),
 * then status `running`. Safe to repeat: the unique index means a second Start (or a retry after a crash
 * half-way) never creates duplicate messages. Nothing is sent here — the worker (Phase 6) does that.
 */
export async function startCampaign(id: string): Promise<StartCampaignResult> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  if (campaign.status !== "draft") {
    throw new ApiError(
      409,
      "CAMPAIGN_ALREADY_STARTED",
      campaign.status === "paused"
        ? "This campaign has already started — use Resume"
        : `This campaign is already ${campaign.status}`,
    );
  }
  const problems = await startProblems(campaign);
  if (problems.length) {
    throw new ApiError(400, "CAMPAIGN_NOT_READY", `Cannot start yet: ${problems.join("; ")}`);
  }

  const created = await createMessages(campaign);
  await Campaign.updateOne(
    { _id: campaign._id, status: "draft" },
    { $set: { status: "running", startedAt: new Date() } },
  );
  const result = await getCampaign(id);
  await logEvent(
    "campaign.started",
    `Campaign "${campaign.name}" started: ${result.counts.pending} queued, ${result.counts.skipped} skipped`,
    { campaignId: campaign._id },
  );
  return {
    campaign: result,
    created,
    pending: result.counts.pending,
    skipped: result.counts.skipped,
  };
}

/** running → paused. Scheduled messages go back to pending (BUILD_PLAN section 6). */
export async function pauseCampaign(id: string): Promise<CampaignDTO> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  const result = await Campaign.updateOne(
    { _id: campaign._id, status: "running" },
    { $set: { status: "paused" } },
  );
  if (result.matchedCount === 0) {
    throw new ApiError(409, "CAMPAIGN_NOT_RUNNING", `Only a running campaign can be paused`);
  }
  const released = await releaseScheduledMessages({ campaignId: campaign._id });
  await logEvent(
    "campaign.paused",
    `Campaign "${campaign.name}" paused${released ? ` (${released} scheduled email(s) back in the queue)` : ""}`,
    { campaignId: campaign._id },
  );
  return getCampaign(id);
}

/** paused → running (the worker picks it up again). */
export async function resumeCampaign(id: string): Promise<CampaignDTO> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  const result = await Campaign.updateOne(
    { _id: campaign._id, status: "paused" },
    { $set: { status: "running" } },
  );
  if (result.matchedCount === 0) {
    throw new ApiError(409, "CAMPAIGN_NOT_PAUSED", "Only a paused campaign can be resumed");
  }
  await logEvent("campaign.resumed", `Campaign "${campaign.name}" resumed`, {
    campaignId: campaign._id,
  });
  return getCampaign(id);
}

// ---------- messages + stats ----------

export async function listCampaignMessages(
  id: string,
  query: { page: number; limit: number; status?: MessageStatus; search?: string },
): Promise<Paginated<MessageDTO>> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  const filter: Record<string, unknown> = { campaignId: campaign._id };
  if (query.status) filter.status = query.status;
  if (query.search) filter.toEmail = { $regex: escapeRegex(query.search.toLowerCase()) };

  const [messages, total] = await Promise.all([
    Message.find(filter)
      .sort({ _id: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<MessageRecord[]>(),
    Message.countDocuments(filter),
  ]);
  const inboxIds = [...new Set(messages.flatMap((m) => (m.inboxId ? [String(m.inboxId)] : [])))];
  const inboxes = await Inbox.find({ _id: { $in: inboxIds } })
    .select("email")
    .lean();
  const inboxEmail = new Map(inboxes.map((i) => [String(i._id), i.email]));

  return {
    data: messages.map((m) => ({
      id: String(m._id),
      contactId: String(m.contactId),
      toEmail: m.toEmail,
      status: m.status as MessageStatus,
      inboxId: m.inboxId ? String(m.inboxId) : null,
      inboxEmail: m.inboxId ? (inboxEmail.get(String(m.inboxId)) ?? null) : null,
      scheduledAt: iso(m.scheduledAt),
      sentAt: iso(m.sentAt),
      attempts: m.attempts,
      renderedSubject: m.renderedSubject ?? null,
      error: m.error?.code ? { code: m.error.code, message: m.error.message ?? "" } : null,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    })),
    page: query.page,
    limit: query.limit,
    total,
  };
}

/** Counts per status + audience + daily capacity + ETA (BUILD_PLAN section 6, "Campaign ETA"). */
export async function getCampaignStats(id: string, now = new Date()): Promise<CampaignStatsDTO> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  const status = campaign.status as CampaignStatus;
  const [countsMap, inboxes, timezone] = await Promise.all([
    countsFor([campaign._id]),
    usableInboxes((campaign.inboxIds ?? []) as Types.ObjectId[]),
    getTimezone(),
  ]);
  const counts = countsMap.get(String(campaign._id)) ?? emptyCounts();
  const totalMessages = sumCounts(counts);

  const audience =
    status === "draft"
      ? await audienceOf(campaign.listId as Types.ObjectId)
      : { total: totalMessages, sendable: totalMessages - counts.skipped, skipped: counts.skipped };
  const remaining =
    status === "draft" ? audience.sendable : counts.pending + counts.scheduled + counts.sending;

  const window = windowOf(campaign);
  let eta: Date | null;
  if (status === "completed") eta = campaign.completedAt ?? null;
  else eta = estimateFinishDate(remaining, inboxes.dailyCapacity, window, timezone, now);

  return {
    status,
    counts,
    totalMessages,
    remaining,
    audience,
    usableInboxes: inboxes.count,
    dailyCapacity: inboxes.dailyCapacity,
    timezone,
    eta: iso(eta),
    nextWindowStart: iso(nextWindowStart(now, window, timezone)),
  };
}
