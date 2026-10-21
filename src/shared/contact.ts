import { z } from "zod";
import { objectIdSchema, paginationSchema } from "./common";
import { CONTACT_STATUSES, type ContactStatus } from "./enums";

export const listContactsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(254).optional(),
  listId: objectIdSchema.optional(),
  status: z.enum(CONTACT_STATUSES).optional(),
});

const text = (max: number) => z.string().trim().max(max, "Too long");

export const updateContactSchema = z
  .object({
    firstName: text(100).optional(),
    lastName: text(100).optional(),
    company: text(200).optional(),
    title: text(200).optional(),
    status: z.enum(CONTACT_STATUSES).optional(),
    listIds: z.array(objectIdSchema).max(100).optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), "Nothing to update");
export type UpdateContactInput = z.input<typeof updateContactSchema>;

export type ContactDTO = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  title: string;
  custom: Record<string, string>;
  listIds: string[];
  status: ContactStatus;
  /** The email is on the suppression list (it will never be emailed). */
  suppressed: boolean;
  createdAt: string;
  updatedAt: string;
};

// ---------- CSV import ----------

/** Where a CSV column goes. Anything that is not a standard field becomes custom.<key>. */
export const STANDARD_FIELDS = ["email", "firstName", "lastName", "company", "title"] as const;
export type StandardField = (typeof STANDARD_FIELDS)[number];
export type ColumnTarget = StandardField | "custom" | "skip";
export const COLUMN_TARGETS = [...STANDARD_FIELDS, "custom", "skip"] as const;

export const FIELD_LABELS: Record<ColumnTarget, string> = {
  email: "Email (required)",
  firstName: "First name",
  lastName: "Last name",
  company: "Company",
  title: "Job title",
  custom: "Custom field",
  skip: "Don't import",
};

/** Column header → key used in templates as {{custom.<key>}}: "Company Size" → "company_size". */
export function customKey(column: string): string {
  const key = column
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!key) return "field";
  return /^[0-9]/.test(key) ? `f_${key}` : key;
}

/** column name → target. */
export const columnMappingSchema = z
  .record(z.string(), z.enum(COLUMN_TARGETS))
  .refine(
    (mapping) => Object.values(mapping).filter((t) => t === "email").length === 1,
    "Choose exactly one column as Email",
  )
  .refine((mapping) => {
    const standard = Object.values(mapping).filter((t) => t !== "custom" && t !== "skip");
    return new Set(standard).size === standard.length;
  }, "Each field (first name, company, …) can only be chosen for one column");
export type ColumnMapping = z.infer<typeof columnMappingSchema>;

export const importConfirmFieldsSchema = z.object({
  listId: objectIdSchema,
  mapping: z
    .string()
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "mapping must be JSON" });
        return z.NEVER;
      }
    })
    .pipe(columnMappingSchema),
});

export type ImportPreview = {
  columns: string[];
  rows: Record<string, string>[];
  totalRows: number;
  suggestedMapping: ColumnMapping;
};

export type InvalidRow = { row: number; email: string; reason: string };

export type ImportReport = {
  total: number;
  created: number;
  updated: number;
  duplicatesInFile: number;
  invalid: number;
  suppressed: number;
  /** First invalid rows (row numbers as in the spreadsheet, header = row 1). */
  invalidRows: InvalidRow[];
};

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50_000;
