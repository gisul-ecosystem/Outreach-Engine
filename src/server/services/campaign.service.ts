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
import {
  campaignTemplates,
  composeEmail,
  pickTemplate,
  senderOf,
  type CampaignTemplates,
} from "@/server/lib/compose";
import { checkEmailContent } from "@/server/lib/content-check";
import { ApiError } from "@/server/lib/errors";
import { renderEmail, type EmailTemplate, type TemplateContact } from "@/server/lib/template";
import type { EmailProvider } from "@/server/providers";
import { estimateFinishDate, isValidWindow, nextWindowStart } from "@/server/scheduler/time";
import { logEvent } from "@/server/services/event.service";
import { testSendFromInbox } from "@/server/services/inbox.service";
import { releaseScheduledMessages } from "@/server/services/queue.service";
import { readinessMustFix } from "@/server/services/readiness.service";
import { getTimezone } from "@/server/services/settings.service";
import type {
  CampaignDTO,
  CampaignPreviewDTO,
  CampaignStatsDTO,
  CampaignVariantInput,
  MessageCounts,
  MessageDTO,
  StartCampaignResult,
} from "@/shared/campaign";
import type { Paginated } from "@/shared/common";
import { MESSAGE_STATUSES, type CampaignStatus, type MessageStatus } from "@/shared/enums";
import type { TestSendResult } from "@/shared/inbox";

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
    templates: campaignTemplates(c).map((t) => ({ name: t.name, matchValues: t.matchValues })),
    templateName: c.templateName ?? "",
    matchValues: [...(c.matchValues ?? [])],
    variants: (c.variants ?? []).map((v) => ({
      name: v.name,
      subjectTemplate: v.subjectTemplate ?? "",
      bodyTemplate: v.bodyTemplate ?? "",
      bodyHtml: v.bodyHtml ?? null,
      matchValues: [...(v.matchValues ?? [])],
    })),
    variantColumn: c.variantColumn ?? "",
    followUpOf: c.followUpOf ? String(c.followUpOf) : null,
    followUpAfterDays: c.followUpAfterDays ?? 3,
    pauseReason: c.pauseReason ?? null,
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

/**
 * A follow-up must point at a normal (not follow-up) campaign that has no other follow-up yet:
 * at most ONE follow-up per person. It uses the same list and inboxes as that campaign.
 */
async function followUpParent(parentId: string, ignoreCampaignId?: Types.ObjectId) {
  const parent = await Campaign.findOne(notDeleted({ _id: parentId })).lean<CampaignRecord>();
  if (!parent)
    throw new ApiError(400, "INVALID_FOLLOW_UP", "followUpOf: That campaign does not exist");
  if (parent.followUpOf) {
    throw new ApiError(
      400,
      "INVALID_FOLLOW_UP",
      "followUpOf: A follow-up cannot follow another follow-up",
    );
  }
  const other = await Campaign.exists(
    notDeleted({
      followUpOf: parent._id,
      ...(ignoreCampaignId ? { _id: { $ne: ignoreCampaignId } } : {}),
    }),
  );
  if (other) {
    throw new ApiError(
      409,
      "FOLLOW_UP_EXISTS",
      `"${parent.name}" already has a follow-up (max 1 per contact)`,
    );
  }
  return parent;
}

export async function createCampaign(input: {
  name: string;
  listId: string;
  inboxIds: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  bodyHtml: string | null;
  sendWindow: SendWindow;
  templateName?: string;
  variantColumn?: string;
  matchValues?: string[];
  variants?: CampaignVariantInput[];
  followUpOf?: string | null;
  followUpAfterDays?: number;
}): Promise<CampaignDTO> {
  await connectDB();
  const data = { ...input };
  if (input.followUpOf) {
    const parent = await followUpParent(input.followUpOf);
    data.listId = String(parent.listId);
    data.inboxIds = (parent.inboxIds ?? []).map(String);
  }
  await assertListExists(data.listId);
  await assertInboxesExist(data.inboxIds);
  const created = await Campaign.create({ ...data, status: "draft" });
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
    templateName?: string;
    variantColumn?: string;
    matchValues?: string[];
    variants?: CampaignVariantInput[];
    followUpAfterDays?: number;
  },
): Promise<CampaignDTO> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  assertEditable(campaign);
  if (campaign.followUpOf && (input.listId !== undefined || input.inboxIds !== undefined)) {
    throw new ApiError(
      409,
      "FOLLOW_UP_LOCKED",
      "A follow-up always uses the list and inboxes of the first campaign",
    );
  }
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

  // Typed-but-unsaved text (the editor) previews the main template; otherwise the version this contact gets.
  const previewContact = contact ?? { email: "someone@example.com" };
  const editing =
    input.subjectTemplate !== undefined ||
    input.bodyTemplate !== undefined ||
    input.bodyHtml !== undefined;
  const templates = campaignTemplates(campaign);
  const saved = editing
    ? templates[0]
    : templates[pickTemplate(templates, campaign.variantColumn, previewContact, 0).index];
  const subjectTemplate = input.subjectTemplate ?? saved.subjectTemplate;
  const bodyTemplate = input.bodyTemplate ?? saved.bodyTemplate;
  const bodyHtml = input.bodyHtml !== undefined ? input.bodyHtml : (saved.bodyHtml ?? null);
  // The signature ({{senderName}}…) comes from the first inbox of the campaign.
  const inbox = campaign.inboxIds?.length
    ? await Inbox.findById(campaign.inboxIds[0])
        .select("email displayName senderName senderRole")
        .lean()
    : null;
  const rendered = renderEmail({ subjectTemplate, bodyTemplate, bodyHtml }, previewContact, {
    ...(inbox ? senderOf(inbox) : {}),
    // Each person's real first-email subject is only known when the follow-up is sent.
    originalSubject: campaign.followUpOf ? "(subject of the first email)" : null,
  });

  const warnings: string[] = [];
  if (!contact) warnings.push("This list has no contacts yet — the preview uses empty values.");
  if (!subjectTemplate.trim()) warnings.push("The subject is empty.");
  if (!bodyTemplate.trim()) warnings.push("The email body is empty.");
  if (templates.length > 1 && !editing)
    warnings.push(`This contact gets the "${saved.name}" version.`);
  if (rendered.missing.length > 0) {
    warnings.push("This contact will be SKIPPED (not emailed) because a field it needs is empty.");
  }
  const content = checkEmailContent({ subjectTemplate, bodyTemplate, bodyHtml });
  warnings.push(...rendered.warnings, ...content.problems, ...content.warnings);

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

// ---------- test to myself ----------

/**
 * "Send test to myself": the campaign's email (the main version, or `version`) filled in with the
 * list's first active contact, sent to `to` from one of the campaign's inboxes through the normal
 * inbox test-send (same suppression and DRY_RUN rules). Remembered for the readiness check.
 */
export async function testSendCampaign(
  id: string,
  input: { to: string; inboxId?: string; version?: number },
  options: { provider?: EmailProvider } = {},
): Promise<TestSendResult> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  const inboxIds = (campaign.inboxIds ?? []).map(String);
  const inboxId = input.inboxId ?? inboxIds[0];
  if (!inboxId || !inboxIds.includes(inboxId)) {
    throw new ApiError(400, "INVALID_INBOX", "Choose one of this campaign's inboxes first");
  }
  const inbox = await Inbox.findOne(notDeleted({ _id: inboxId }))
    .select("email displayName senderName senderRole")
    .lean();
  if (!inbox) throw new ApiError(400, "INVALID_INBOX", "That inbox was deleted");

  const templates = campaignTemplates(campaign);
  const template = templates[input.version ?? 0] ?? templates[0];
  const sample = await Contact.findOne(notDeleted({ listIds: campaign.listId, status: "active" }))
    .sort({ createdAt: 1, _id: 1 })
    .lean<TemplateContact>();
  const { rendered, input: email } = composeEmail({
    template,
    contact: { ...(sample ?? {}), email: input.to },
    inbox,
    to: input.to,
    originalSubject: campaign.followUpOf ? "Your first email's subject" : null,
  });
  if (rendered.missing.length) {
    throw new ApiError(
      400,
      "MISSING_FIELDS",
      `The test cannot be built: ${rendered.missing.map((n) => `{{${n}}}`).join(", ")} is empty${sample ? ` for the sample contact ${sample.email}` : ""}. Add a fallback or fill in the inbox signature.`,
    );
  }
  const result = await testSendFromInbox(String(inbox._id), input.to, {
    provider: options.provider,
    email: {
      subject: email.subject,
      text: email.text,
      html: email.html,
      messageId: email.messageId,
      listUnsubscribe: email.listUnsubscribe,
    },
    campaignId: campaign._id,
  });
  await Campaign.updateOne({ _id: campaign._id }, { $set: { testSentAt: new Date() } });
  return result;
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

/** Sender values are checked per inbox in startProblems, so here they only need to be "filled in". */
const ANY_SENDER = { name: "-", role: "-", email: "-", originalSubject: "-" };

/** Skipped instead of sent when the template needs a field this contact does not have ("Hi ,"). */
export function missingFieldsReason(template: EmailTemplate, contact: TemplateContact) {
  const { missing } = renderEmail(template, contact, ANY_SENDER);
  if (missing.length === 0) return null;
  return {
    code: "MISSING_FIELDS",
    message: `Not sent: ${missing.map((name) => `{{${name}}}`).join(", ")} empty for this contact`,
  };
}

type ContactRow = TemplateContact & { _id: Types.ObjectId; status: string };

/**
 * One message per contact in the list: `pending`, or `skipped` (with the reason) if it must not be emailed.
 * Each message gets its template version (rotation): the contact's column decides, otherwise in turn.
 */
async function createMessages(campaign: CampaignRecord): Promise<number> {
  const templates = campaignTemplates(campaign);
  let unmatchedTurn = 0;
  let created = 0;
  let batch: ContactRow[] = [];

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
      const pick = pickTemplate(templates, campaign.variantColumn, c, unmatchedTurn);
      if (!pick.matched) unmatchedTurn++;
      const template = templates[pick.index];
      const reason =
        skipReason(c.status, suppressed.has(c.email)) ?? missingFieldsReason(template, c);
      return {
        campaignId: campaign._id,
        contactId: c._id,
        toEmail: c.email,
        status: reason ? "skipped" : "pending",
        error: reason,
        variantIndex: pick.index,
        templateName: template.name,
      };
    });
    created += await insertIgnoringDuplicates(docs);
    batch = [];
  };

  const cursor = Contact.find(notDeleted({ listIds: campaign.listId }))
    .select("email status firstName lastName company title custom")
    .sort({ _id: 1 })
    .lean<ContactRow[]>()
    .cursor({ batchSize: BATCH });
  for await (const contact of cursor) {
    batch.push(contact as unknown as ContactRow);
    if (batch.length >= BATCH) await flush();
  }
  await flush();
  return created;
}

/**
 * Follow-ups are created as people become due: the first email was sent at least `followUpAfterDays`
 * ago, got no reply and did not bounce. Called by the planner every tick; safe to repeat (unique index).
 * The follow-up must come from the inbox that sent the first email (same thread), so it is remembered.
 */
export async function syncFollowUpMessages(
  campaign: CampaignTemplates & {
    _id: Types.ObjectId;
    followUpOf?: Types.ObjectId | null;
    followUpAfterDays?: number | null;
  },
  now = new Date(),
): Promise<number> {
  if (!campaign.followUpOf) return 0;
  const cutoff = new Date(now.getTime() - (campaign.followUpAfterDays ?? 3) * 24 * 60 * 60 * 1000);
  const existing = await Message.find({ campaignId: campaign._id })
    .select("parentMessageId")
    .lean();
  const done = existing.flatMap((m) => (m.parentMessageId ? [m.parentMessageId] : []));
  const due = await Message.find({
    campaignId: campaign.followUpOf,
    status: "sent",
    sentAt: { $lte: cutoff },
    repliedAt: null,
    bounce: null,
    _id: { $nin: done },
  })
    .select("contactId toEmail inboxId")
    .limit(BATCH)
    .lean();
  if (due.length === 0) return 0;

  const [contacts, suppressed] = await Promise.all([
    Contact.find({ _id: { $in: due.map((m) => m.contactId) } })
      .select("email status deletedAt firstName lastName company title custom")
      .lean<(ContactRow & { deletedAt?: Date | null })[]>(),
    Suppression.find({ email: { $in: due.map((m) => m.toEmail) } })
      .select("email")
      .lean(),
  ]);
  const byId = new Map(contacts.map((c) => [String(c._id), c]));
  const blocked = new Set(suppressed.map((s) => s.email));
  const template = campaignTemplates(campaign)[0];

  const docs = due.map((parent) => {
    const contact = byId.get(String(parent.contactId));
    const reason = !contact
      ? { code: "CONTACT_DELETED", message: "The contact was deleted" }
      : contact.deletedAt
        ? { code: "CONTACT_DELETED", message: "The contact was deleted" }
        : (skipReason(contact.status, blocked.has(parent.toEmail)) ??
          missingFieldsReason(template, contact));
    return {
      campaignId: campaign._id,
      contactId: parent.contactId,
      toEmail: parent.toEmail,
      status: reason ? "skipped" : "pending",
      error: reason,
      variantIndex: 0,
      templateName: template.name,
      parentMessageId: parent._id,
      parentInboxId: parent.inboxId,
    };
  });
  return insertIgnoringDuplicates(docs);
}

/** What is missing before a campaign can start (empty = ready). */
async function startProblems(campaign: CampaignRecord): Promise<string[]> {
  const problems: string[] = [];
  const listOk = await List.exists(notDeleted({ _id: campaign.listId }));
  if (!listOk) problems.push("The list was deleted — choose another list");
  if (!campaign.subjectTemplate?.trim()) problems.push("Write a subject");
  if (!campaign.bodyTemplate?.trim()) problems.push("Write the email body");
  for (const variant of campaign.variants ?? []) {
    if (!variant.subjectTemplate?.trim() || !variant.bodyTemplate?.trim()) {
      problems.push(`Template "${variant.name}" needs a subject and a body`);
    }
  }
  if (!isValidWindow(windowOf(campaign))) problems.push("Choose at least one sending day");
  const { count } = await usableInboxes((campaign.inboxIds ?? []) as Types.ObjectId[]);
  if (count === 0) problems.push("Choose at least one active inbox (with an active domain)");
  if (campaign.followUpOf) {
    // People are added as they become due, so an empty list today is fine.
    if (!(await Campaign.exists(notDeleted({ _id: campaign.followUpOf })))) {
      problems.push("The first campaign of this follow-up was deleted");
    }
  } else if (listOk && (await audienceOf(campaign.listId as Types.ObjectId)).sendable === 0) {
    problems.push("No contact in this list can be emailed (empty, unsubscribed or suppressed)");
  }
  // The readiness panel's "Must fix" items (wording, typos, placeholders, signatures, DNS), enforced
  // here so they hold even if the browser is bypassed. Empty subject/body are reported above.
  problems.push(...(await readinessMustFix(campaign, { skipChecks: ["subject", "body"] })));
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

  const created = campaign.followUpOf ? 0 : await createMessages(campaign);
  await Campaign.updateOne(
    { _id: campaign._id, status: "draft" },
    {
      $set: { status: "running", startedAt: new Date(), pauseReason: null, consecutiveFailures: 0 },
    },
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
    { $set: { status: "paused", pauseReason: null } },
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

/**
 * Stop-on-error: running → paused by the engine itself, with the reason (shown as a red alert on the
 * dashboard). Its scheduled emails go back to the queue. Returns false if it was not running.
 */
export async function autoPauseCampaign(
  campaignId: Types.ObjectId,
  reason: string,
): Promise<boolean> {
  const paused = await Campaign.findOneAndUpdate(
    { _id: campaignId, status: "running" },
    { $set: { status: "paused", pauseReason: reason } },
  );
  if (!paused) return false;
  await releaseScheduledMessages({ campaignId });
  await logEvent("campaign.auto_paused", `ALERT: campaign "${paused.name}" paused — ${reason}`, {
    campaignId,
  });
  return true;
}

/**
 * paused → running (the worker picks it up again). The email and setup are checked again (the
 * readiness "Must fix" items) in case something was edited while paused.
 */
export async function resumeCampaign(id: string): Promise<CampaignDTO> {
  await connectDB();
  const campaign = await findCampaignOr404(id);
  const problems = campaign.status === "paused" ? await readinessMustFix(campaign) : [];
  if (problems.length) {
    throw new ApiError(400, "CAMPAIGN_NOT_READY", `Cannot resume yet: ${problems.join("; ")}`);
  }
  const result = await Campaign.updateOne(
    { _id: campaign._id, status: "paused" },
    { $set: { status: "running", pauseReason: null, consecutiveFailures: 0 } },
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
      templateName: m.templateName ?? null,
      repliedAt: iso(m.repliedAt),
      bounce: m.bounce?.code ? { code: m.bounce.code, message: m.bounce.message ?? "" } : null,
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
