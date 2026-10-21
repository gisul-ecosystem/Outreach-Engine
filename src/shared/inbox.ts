import { z } from "zod";
import { objectIdSchema, paginationSchema } from "./common";
import { emailSchema } from "./email";
import { INBOX_STATUSES, type InboxStatus } from "./enums";

export const MAX_DAILY_LIMIT = 200;
export const MIN_GAP_SECONDS = 30;
export const MAX_GAP_SECONDS = 24 * 60 * 60;
/** BUILD_PLAN section 11: new inboxes should start at 10–15/day; show a hint above this. */
export const DAILY_LIMIT_HINT_ABOVE = 20;

const dailyLimit = z.coerce
  .number({ error: "Enter a number" })
  .int("Whole numbers only")
  .min(1, "At least 1 email per day")
  .max(MAX_DAILY_LIMIT, `At most ${MAX_DAILY_LIMIT} per day`);
const gapSeconds = z.coerce
  .number({ error: "Enter a number" })
  .int("Whole seconds only")
  .min(MIN_GAP_SECONDS, `At least ${MIN_GAP_SECONDS} seconds`)
  .max(MAX_GAP_SECONDS, "At most 24 hours");
const displayName = z.string().trim().max(100, "Display name is too long");

const gapOrder = (v: { minGapSeconds?: number; maxGapSeconds?: number }) =>
  v.minGapSeconds === undefined ||
  v.maxGapSeconds === undefined ||
  v.minGapSeconds <= v.maxGapSeconds;
const gapOrderError = {
  message: "Minimum gap must be less than or equal to the maximum gap",
  path: ["maxGapSeconds"],
};

export const createInboxSchema = z
  .object({
    domainId: objectIdSchema,
    providerConnectionId: objectIdSchema,
    email: emailSchema,
    displayName: displayName.default(""),
    // Optional: the server fills in the defaults from Settings.
    dailyLimit: dailyLimit.optional(),
    minGapSeconds: gapSeconds.optional(),
    maxGapSeconds: gapSeconds.optional(),
  })
  .refine(gapOrder, gapOrderError);
export type CreateInboxInput = z.input<typeof createInboxSchema>;

export const updateInboxSchema = z
  .object({
    displayName: displayName.optional(),
    providerConnectionId: objectIdSchema.optional(),
    dailyLimit: dailyLimit.optional(),
    minGapSeconds: gapSeconds.optional(),
    maxGapSeconds: gapSeconds.optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), "Nothing to update")
  .refine(gapOrder, gapOrderError);
export type UpdateInboxInput = z.input<typeof updateInboxSchema>;

export const pauseInboxSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});

export const testSendSchema = z.object({ to: emailSchema });
export type TestSendInput = z.input<typeof testSendSchema>;

export const listInboxesQuerySchema = paginationSchema.extend({
  domainId: objectIdSchema.optional(),
  status: z.enum(INBOX_STATUSES).optional(),
  search: z.string().trim().max(254).optional(),
});

/** The part after "@", lowercased. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

export type InboxDTO = {
  id: string;
  email: string;
  displayName: string;
  domainId: string;
  domainName: string;
  providerConnectionId: string | null;
  providerName: string | null;
  status: InboxStatus;
  pauseReason: string | null;
  dailyLimit: number;
  minGapSeconds: number;
  maxGapSeconds: number;
  lastSentAt: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
};

export type TestSendResult = {
  mode: "dry-run" | "live";
  to: string;
  from: string;
  providerMessageId: string | null;
};

// ---------- Import mailboxes from the provider (e.g. Microsoft 365) ----------

export const discoverMailboxesQuerySchema = z.object({
  /** Optional: use this connection instead of the one saved on the domain. */
  providerConnectionId: objectIdSchema.optional(),
});

export const importInboxesSchema = z.object({
  providerConnectionId: objectIdSchema.optional(),
  emails: z.array(emailSchema).min(1, "Choose at least one mailbox").max(200),
  /** Default false: the user ticked these mailboxes on purpose, so they are ready to use. */
  startPaused: z.boolean().default(false),
});
export type ImportInboxesInput = z.input<typeof importInboxesSchema>;

export type DiscoveredMailbox = {
  email: string;
  displayName: string;
  /** false = the Microsoft account is disabled (blocked from signing in). */
  enabled: boolean;
  /** true = already added as an inbox. */
  alreadyAdded: boolean;
};

export type DiscoverMailboxesResult = {
  domainName: string;
  providerConnectionId: string;
  mailboxes: DiscoveredMailbox[];
};

export type ImportInboxesResult = {
  imported: string[];
  skipped: { email: string; reason: string }[];
};
