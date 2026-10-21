import { z } from "zod";
import { paginationSchema } from "./common";
import { emailSchema } from "./email";
import { SUPPRESSION_REASONS, type ContactStatus, type SuppressionReason } from "./enums";

export const createSuppressionSchema = z.object({
  email: emailSchema,
  reason: z.enum(SUPPRESSION_REASONS).default("manual"),
  note: z.string().trim().max(500, "Note is too long").default(""),
});
export type CreateSuppressionInput = z.input<typeof createSuppressionSchema>;

/** Form fields sent with the CSV file to POST /api/suppressions/import. */
export const importSuppressionsFieldsSchema = z.object({
  reason: z.enum(SUPPRESSION_REASONS).default("manual"),
  note: z.string().trim().max(500).default(""),
});

export const listSuppressionsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(254).optional(),
  reason: z.enum(SUPPRESSION_REASONS).optional(),
});

/** What a matching contact's status becomes when its email is suppressed. */
export function contactStatusForSuppression(reason: SuppressionReason): ContactStatus {
  return reason === "bounced" ? "bounced" : "unsubscribed";
}

export type SuppressionDTO = {
  id: string;
  email: string;
  reason: SuppressionReason;
  note: string;
  createdAt: string;
};

export type SuppressionImportReport = {
  total: number;
  added: number;
  alreadySuppressed: number;
  duplicatesInFile: number;
  invalid: number;
  contactsUpdated: number;
};
