import { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Contact, List, Suppression, type ContactDoc } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import {
  buildContacts,
  parseCsv,
  suggestMapping,
  type ParsedContact,
} from "@/server/lib/csv-import";
import { ApiError } from "@/server/lib/errors";
import { logEvent } from "@/server/services/event.service";
import { findListOr404 } from "@/server/services/list.service";
import { syncContactsWithSuppressions } from "@/server/services/suppression.service";
import type { Paginated } from "@/shared/common";
import type { ColumnMapping, ContactDTO, ImportPreview, ImportReport } from "@/shared/contact";
import type { ContactStatus, SuppressionReason } from "@/shared/enums";
import { contactStatusForSuppression } from "@/shared/suppression";

type ContactRecord = ContactDoc & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const BATCH = 1000;
const PREVIEW_ROWS = 20;
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function toDTO(c: ContactRecord, suppressed: boolean): ContactDTO {
  const custom = c.custom instanceof Map ? Object.fromEntries(c.custom) : (c.custom ?? {});
  return {
    id: String(c._id),
    email: c.email,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    company: c.company ?? "",
    title: c.title ?? "",
    custom: custom as Record<string, string>,
    listIds: (c.listIds ?? []).map(String),
    status: c.status as ContactStatus,
    suppressed,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** Suppression reason per email, for the given emails (looked up in batches). */
async function suppressionsFor(emails: string[]): Promise<Map<string, SuppressionReason>> {
  const found = new Map<string, SuppressionReason>();
  for (let i = 0; i < emails.length; i += BATCH) {
    const rows = await Suppression.find({ email: { $in: emails.slice(i, i + BATCH) } })
      .select("email reason")
      .lean();
    for (const row of rows) found.set(row.email, row.reason as SuppressionReason);
  }
  return found;
}

async function findContactOr404(id: string): Promise<ContactRecord> {
  const contact = await Contact.findOne(notDeleted({ _id: id })).lean<ContactRecord>();
  if (!contact) throw new ApiError(404, "CONTACT_NOT_FOUND", "Contact not found");
  return contact;
}

async function dto(contact: ContactRecord) {
  return toDTO(contact, Boolean(await Suppression.exists({ email: contact.email })));
}

export async function listContacts(query: {
  page: number;
  limit: number;
  search?: string;
  listId?: string;
  status?: ContactStatus;
}): Promise<Paginated<ContactDTO>> {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (query.listId) filter.listIds = new Types.ObjectId(query.listId);
  if (query.status) filter.status = query.status;
  if (query.search) {
    const pattern = { $regex: escapeRegex(query.search), $options: "i" };
    filter.$or = ["email", "firstName", "lastName", "company"].map((field) => ({
      [field]: pattern,
    }));
  }
  const [contacts, total] = await Promise.all([
    Contact.find(notDeleted(filter))
      .sort({ createdAt: -1, _id: -1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ContactRecord[]>(),
    Contact.countDocuments(notDeleted(filter)),
  ]);
  const suppressed = await suppressionsFor(contacts.map((c) => c.email));
  return {
    data: contacts.map((c) => toDTO(c, suppressed.has(c.email))),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function getContact(id: string): Promise<ContactDTO> {
  await connectDB();
  return dto(await findContactOr404(id));
}

export async function updateContact(
  id: string,
  input: {
    firstName?: string;
    lastName?: string;
    company?: string;
    title?: string;
    status?: ContactStatus;
    listIds?: string[];
  },
): Promise<ContactDTO> {
  await connectDB();
  const contact = await findContactOr404(id);

  // Safety rule: a suppressed email can never become active.
  if (input.status === "active" && (await Suppression.exists({ email: contact.email }))) {
    throw new ApiError(
      409,
      "SUPPRESSED",
      `${contact.email} is on the suppression list. Remove it there first to make the contact active.`,
    );
  }
  if (input.listIds) {
    const unique = [...new Set(input.listIds)];
    const found = await List.countDocuments(notDeleted({ _id: { $in: unique } }));
    if (found !== unique.length)
      throw new ApiError(400, "INVALID_LIST", "One of the lists does not exist");
    input.listIds = unique;
  }
  const update = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  await Contact.updateOne({ _id: contact._id }, { $set: update });
  return getContact(id);
}

/** Soft delete: the contact disappears from lists and searches; its sending history stays. */
export async function deleteContact(id: string): Promise<{ id: string }> {
  await connectDB();
  const contact = await findContactOr404(id);
  await Contact.updateOne({ _id: contact._id }, { $set: { deletedAt: new Date() } });
  return { id };
}

// ---------- CSV import ----------

/** Step 1: read the file and suggest a column mapping. Nothing is saved. */
export function previewImport(csvText: string): ImportPreview {
  const { columns, rows } = parseCsv(csvText);
  return {
    columns,
    rows: rows.slice(0, PREVIEW_ROWS),
    totalRows: rows.length,
    suggestedMapping: suggestMapping(columns),
  };
}

/**
 * Upserts contacts by email in batches of 1,000 and adds them to the list.
 * - New contacts are created (status from the suppression list if the email is suppressed).
 * - Existing contacts get the list added and only NON-EMPTY values updated (never blanked).
 * - A previously deleted contact that is imported again is restored.
 */
export async function importContacts(
  contacts: ParsedContact[],
  listId: string,
): Promise<{ created: number; updated: number; suppressed: number }> {
  const list = await findListOr404(listId);
  const suppressed = await suppressionsFor(contacts.map((c) => c.email));

  let created = 0;
  let updated = 0;
  for (let i = 0; i < contacts.length; i += BATCH) {
    const ops = contacts.slice(i, i + BATCH).map((c) => {
      const set: Record<string, unknown> = { deletedAt: null };
      const onInsert: Record<string, unknown> = {};
      for (const field of ["firstName", "lastName", "company", "title"] as const) {
        if (c[field]) set[field] = c[field];
        else onInsert[field] = "";
      }
      const customEntries = Object.entries(c.custom);
      for (const [key, value] of customEntries) set[`custom.${key}`] = value;
      if (customEntries.length === 0) onInsert.custom = {};
      const reason = suppressed.get(c.email);
      onInsert.status = reason ? contactStatusForSuppression(reason) : "active";

      return {
        updateOne: {
          filter: { email: c.email },
          update: { $set: set, $setOnInsert: onInsert, $addToSet: { listIds: list._id } },
          upsert: true,
          setDefaultsOnInsert: false, // we set every field ourselves (avoids conflicts with custom.*)
        },
      };
    });
    const result = await Contact.bulkWrite(ops, { ordered: false });
    created += result.upsertedCount;
    updated += result.matchedCount;
  }

  // Existing active contacts whose email is suppressed → unsubscribed / bounced.
  const byReason = new Map<SuppressionReason, string[]>();
  for (const [email, reason] of suppressed)
    byReason.set(reason, [...(byReason.get(reason) ?? []), email]);
  for (const [reason, emails] of byReason) await syncContactsWithSuppressions(emails, reason);

  return { created, updated, suppressed: suppressed.size };
}

/** Step 2: parse the same file with the chosen mapping and import into the list. */
export async function confirmImport(
  csvText: string,
  mapping: ColumnMapping,
  listId: string,
): Promise<ImportReport> {
  await connectDB();
  const { columns, rows } = parseCsv(csvText);
  const unknown = Object.keys(mapping).filter((column) => !columns.includes(column));
  if (unknown.length) {
    throw new ApiError(
      400,
      "MAPPING_MISMATCH",
      `These columns are not in the file: ${unknown.join(", ")}`,
    );
  }
  const parsed = buildContacts(rows, mapping);
  const result = await importContacts(parsed.contacts, listId);
  await logEvent(
    "contacts.imported",
    `CSV import: ${result.created} created, ${result.updated} updated, ${parsed.invalid} invalid`,
  );
  return {
    total: parsed.total,
    created: result.created,
    updated: result.updated,
    duplicatesInFile: parsed.duplicatesInFile,
    invalid: parsed.invalid,
    suppressed: result.suppressed,
    invalidRows: parsed.invalidRows,
  };
}
