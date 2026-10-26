import type { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Contact, Suppression, type SuppressionDoc } from "@/server/db/models";
import { findEmailColumn, parseCsv } from "@/server/lib/csv-import";
import { ApiError } from "@/server/lib/errors";
import { logEvent } from "@/server/services/event.service";
import type { Paginated } from "@/shared/common";
import { isValidEmail, normalizeEmail } from "@/shared/email";
import type { SuppressionReason } from "@/shared/enums";
import {
  contactStatusForSuppression,
  type SuppressionDTO,
  type SuppressionImportReport,
} from "@/shared/suppression";

type SuppressionRecord = SuppressionDoc & { _id: Types.ObjectId; createdAt: Date };

const BATCH = 1000;
const DUPLICATE_KEY = 11000;
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toDTO(s: SuppressionRecord): SuppressionDTO {
  return {
    id: String(s._id),
    email: s.email,
    reason: s.reason as SuppressionReason,
    note: s.note ?? "",
    createdAt: s.createdAt.toISOString(),
  };
}

/**
 * Marks matching ACTIVE contacts as unsubscribed / bounced (BUILD_PLAN: never email suppressed people).
 * Contacts that are already unsubscribed or bounced keep their status.
 */
export async function syncContactsWithSuppressions(
  emails: string[],
  reason: SuppressionReason,
): Promise<number> {
  let updated = 0;
  for (let i = 0; i < emails.length; i += BATCH) {
    const result = await Contact.updateMany(
      { email: { $in: emails.slice(i, i + BATCH) }, status: "active" },
      { $set: { status: contactStatusForSuppression(reason) } },
    );
    updated += result.modifiedCount;
  }
  return updated;
}

export async function listSuppressions(query: {
  page: number;
  limit: number;
  search?: string;
  reason?: SuppressionReason;
}): Promise<Paginated<SuppressionDTO>> {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (query.search) filter.email = { $regex: escapeRegex(query.search.toLowerCase()) };
  if (query.reason) filter.reason = query.reason;
  const [items, total] = await Promise.all([
    Suppression.find(filter)
      .sort({ createdAt: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<SuppressionRecord[]>(),
    Suppression.countDocuments(filter),
  ]);
  return { data: items.map(toDTO), page: query.page, limit: query.limit, total };
}

export async function createSuppression(input: {
  email: string;
  reason: SuppressionReason;
  note: string;
}): Promise<SuppressionDTO> {
  await connectDB();
  const exists = () =>
    new ApiError(409, "ALREADY_SUPPRESSED", `${input.email} is already on the suppression list`);
  if (await Suppression.exists({ email: input.email })) throw exists();

  let created;
  try {
    created = await Suppression.create(input);
  } catch (err) {
    if ((err as { code?: number }).code === DUPLICATE_KEY) throw exists();
    throw err;
  }
  await syncContactsWithSuppressions([input.email], input.reason);
  await logEvent(
    "suppression.added",
    `${input.email} added to the suppression list (${input.reason})`,
  );
  return toDTO(created.toObject() as SuppressionRecord);
}

/**
 * Someone replied "no" / "unsubscribe": never email them again. Returns true when they were newly
 * added (already suppressed = false). Used by the mailbox tick and the hand-sent reply reader.
 */
export async function suppressOptOutReply(
  email: string,
  replyText: string,
  refs: { campaignId?: Types.ObjectId | null } = {},
): Promise<boolean> {
  const added = await Suppression.updateOne(
    { email },
    {
      $setOnInsert: {
        email,
        reason: "unsubscribed",
        note: `Replied "${replyText.trim().split(/\r?\n/)[0]?.slice(0, 60) ?? "no"}"`,
      },
    },
    { upsert: true },
  );
  if (added.upsertedCount === 0) return false;
  await syncContactsWithSuppressions([email], "unsubscribed");
  await logEvent("suppression.added", `${email} replied "no" — added to the suppression list`, {
    campaignId: refs.campaignId ?? null,
  });
  return true;
}

/**
 * Removes an email from the suppression list (hard delete — a deliberate action).
 * The contact's status is NOT changed back automatically; edit the contact to make it active again.
 */
export async function deleteSuppression(id: string): Promise<{ id: string }> {
  await connectDB();
  const removed = await Suppression.findByIdAndDelete(id).lean<SuppressionRecord>();
  if (!removed) throw new ApiError(404, "SUPPRESSION_NOT_FOUND", "Suppression not found");
  await logEvent("suppression.removed", `${removed.email} removed from the suppression list`);
  return { id };
}

/** CSV with an "email" column → suppression list. Existing entries are left unchanged. */
export async function importSuppressions(
  csvText: string,
  options: { reason: SuppressionReason; note: string },
): Promise<SuppressionImportReport> {
  await connectDB();
  const { columns, rows } = parseCsv(csvText);
  const emailColumn = findEmailColumn(columns);

  const unique = new Set<string>();
  let invalid = 0;
  let duplicatesInFile = 0;
  for (const row of rows) {
    const email = normalizeEmail(row[emailColumn] ?? "");
    if (!isValidEmail(email)) invalid++;
    else if (unique.has(email)) duplicatesInFile++;
    else unique.add(email);
  }

  const emails = [...unique];
  let added = 0;
  for (let i = 0; i < emails.length; i += BATCH) {
    const result = await Suppression.bulkWrite(
      emails.slice(i, i + BATCH).map((email) => ({
        updateOne: {
          filter: { email },
          update: { $setOnInsert: { email, reason: options.reason, note: options.note } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    added += result.upsertedCount;
  }
  const contactsUpdated = await syncContactsWithSuppressions(emails, options.reason);
  await logEvent(
    "suppression.imported",
    `${added} email(s) added to the suppression list from CSV`,
  );

  return {
    total: rows.length,
    added,
    alreadySuppressed: emails.length - added,
    duplicatesInFile,
    invalid,
    contactsUpdated,
  };
}
