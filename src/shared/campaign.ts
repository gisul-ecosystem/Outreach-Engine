import { z } from "zod";
import { objectIdSchema, paginationSchema } from "./common";
import { emailSchema } from "./email";
import {
  CAMPAIGN_STATUSES,
  DEFAULTS,
  MESSAGE_STATUSES,
  type CampaignStatus,
  type MessageStatus,
} from "./enums";

/** Variables every contact has; custom.<key> comes from the CSV columns. */
export const STANDARD_VARIABLES = ["firstName", "lastName", "company", "title", "email"] as const;
export type StandardVariable = (typeof STANDARD_VARIABLES)[number];
/**
 * Variables about the sending: the inbox (for the signature) and, in a follow-up,
 * originalSubject = the subject of the first email (e.g. "Re: {{originalSubject}}").
 */
export const SENDER_VARIABLES = [
  "senderName",
  "senderRole",
  "senderEmail",
  "originalSubject",
] as const;
export type SenderVariable = (typeof SENDER_VARIABLES)[number];

/** BUILD_PLAN section 11: every email includes a simple opt-out line. */
export const OPT_OUT_LINE = "Not relevant? Just reply 'no' and I won't email again.";
export const DEFAULT_BODY_TEMPLATE = `Hi {{firstName|there}},\n\n\n\n${OPT_OUT_LINE}`;

export const MAX_SUBJECT_LENGTH = 300;
export const MAX_BODY_LENGTH = 20_000;
export const MAX_CAMPAIGN_INBOXES = 100;

export const WEEKDAYS = [
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
  { value: 7, short: "Sun" },
] as const;

/** 600 → "10:00", 1440 → "24:00". */
export function minuteToTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "10:00" → 600 (null if not HH:MM). "24:00" is allowed as the end of the day. */
export function timeToMinute(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[2]) > 59 || minute > 1440) return null;
  return minute;
}

export const sendWindowSchema = z
  .object({
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1, "Choose at least one day")
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  })
  .refine((w) => w.startMinute < w.endMinute, {
    message: "The end time must be after the start time",
    path: ["endMinute"],
  });
export type SendWindowInput = z.input<typeof sendWindowSchema>;

const name = z.string().trim().min(1, "Enter a campaign name").max(200, "Name is too long");
const subject = z.string().max(MAX_SUBJECT_LENGTH, `At most ${MAX_SUBJECT_LENGTH} characters`);
const body = z.string().max(MAX_BODY_LENGTH, "The email is too long");
const inboxIds = z
  .array(objectIdSchema)
  .max(MAX_CAMPAIGN_INBOXES)
  .transform((ids) => [...new Set(ids)]);

/** Words in the rotation column that pick a template, e.g. ["ai", "ml"]. */
const matchValues = z.array(z.string().trim().min(1).max(100)).max(50);
const templateName = z.string().trim().max(200);
/** Contact field that picks the template version: a standard field or custom.<key>. */
const variantColumn = z
  .string()
  .trim()
  .max(100)
  .refine(
    (v) => v === "" || /^(firstName|lastName|company|title|email|custom\.[\w.-]+)$/i.test(v),
    "Use a contact field like title, company or custom.segment",
  );

/** An extra version of the campaign email (template rotation). */
export const campaignVariantSchema = z.object({
  name: z.string().trim().min(1, "Give the template a name").max(200),
  subjectTemplate: subject,
  bodyTemplate: body,
  bodyHtml: body.nullable().default(null),
  matchValues: matchValues.default([]),
});
export type CampaignVariantInput = z.output<typeof campaignVariantSchema>;
const variants = z.array(campaignVariantSchema).max(5);
const followUpAfterDays = z.number().int().min(1).max(30);

/** A draft may be incomplete — Start checks that subject, body and inboxes are filled in. */
export const createCampaignSchema = z.object({
  name,
  listId: objectIdSchema,
  inboxIds: inboxIds.default([]),
  subjectTemplate: subject.default(""),
  bodyTemplate: body.default(DEFAULT_BODY_TEMPLATE),
  bodyHtml: body.nullable().default(null),
  sendWindow: sendWindowSchema.default({
    startMinute: DEFAULTS.sendWindow.startMinute,
    endMinute: DEFAULTS.sendWindow.endMinute,
    days: [...DEFAULTS.sendWindow.days],
  }),
  templateName: templateName.default(""),
  variantColumn: variantColumn.default(""),
  matchValues: matchValues.default([]),
  variants: variants.default([]),
  /** Makes this campaign the follow-up of another one (same list and inboxes, set automatically). */
  followUpOf: objectIdSchema.nullable().default(null),
  followUpAfterDays: followUpAfterDays.default(3),
});
export type CreateCampaignInput = z.input<typeof createCampaignSchema>;

export const updateCampaignSchema = z
  .object({
    name: name.optional(),
    listId: objectIdSchema.optional(),
    inboxIds: inboxIds.optional(),
    subjectTemplate: subject.optional(),
    bodyTemplate: body.optional(),
    bodyHtml: body.nullable().optional(),
    sendWindow: sendWindowSchema.optional(),
    templateName: templateName.optional(),
    variantColumn: variantColumn.optional(),
    matchValues: matchValues.optional(),
    variants: variants.optional(),
    followUpAfterDays: followUpAfterDays.optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), "Nothing to update");
export type UpdateCampaignInput = z.input<typeof updateCampaignSchema>;

/**
 * Preview for one contact of the campaign's list (the first active one if contactId is missing).
 * The optional templates let the editor preview what is typed before it is saved.
 */
export const previewCampaignSchema = z.object({
  contactId: objectIdSchema.optional(),
  subjectTemplate: subject.optional(),
  bodyTemplate: body.optional(),
  bodyHtml: body.nullable().optional(),
});
export type PreviewCampaignInput = z.input<typeof previewCampaignSchema>;

/** "Send test to myself": the campaign's email to one address (default: main version, first inbox). */
export const testSendCampaignSchema = z.object({
  to: emailSchema,
  inboxId: objectIdSchema.optional(),
  version: z.number().int().min(0).max(5).optional(),
});
export type TestSendCampaignInput = z.input<typeof testSendCampaignSchema>;

export const listCampaignsQuerySchema = paginationSchema.extend({
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  search: z.string().trim().max(200).optional(),
});

export const listMessagesQuerySchema = paginationSchema.extend({
  status: z.enum(MESSAGE_STATUSES).optional(),
  search: z.string().trim().max(254).optional(),
});

export type MessageCounts = Record<MessageStatus, number>;

export type CampaignDTO = {
  id: string;
  name: string;
  listId: string;
  listName: string | null;
  inboxIds: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  bodyHtml: string | null;
  /** All template versions (the first is the main one) and the words that pick each. */
  templates: { name: string; matchValues: string[] }[];
  /** Name of the main template ("" = the campaign name) and the words that pick it. */
  templateName: string;
  matchValues: string[];
  /** The extra versions, complete (for the editor). */
  variants: CampaignVariantInput[];
  /** Contact field used to pick the version; "" = versions are used in turn. */
  variantColumn: string;
  /** Set = this is the follow-up of that campaign. */
  followUpOf: string | null;
  followUpAfterDays: number;
  /** Why the engine paused it by itself (stop-on-error), null otherwise. */
  pauseReason: string | null;
  sendWindow: { startMinute: number; endMinute: number; days: number[] };
  status: CampaignStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Messages per status (all 0 for a draft). */
  counts: MessageCounts;
  totalMessages: number;
};

export type CampaignStatsDTO = {
  status: CampaignStatus;
  counts: MessageCounts;
  totalMessages: number;
  /** pending + scheduled + sending (for a draft: contacts that would get a message). */
  remaining: number;
  /** Before Start: who in the list will get a message and who will be skipped. */
  audience: { total: number; sendable: number; skipped: number };
  /** Inboxes that can send right now (active, not deleted, domain active) and their summed daily limits. */
  usableInboxes: number;
  dailyCapacity: number;
  timezone: string;
  /** Estimated finish date (ISO) or null when it cannot finish (no capacity). */
  eta: string | null;
  /** Next moment inside the send window (ISO). */
  nextWindowStart: string | null;
};

export type CampaignPreviewDTO = {
  contact: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    company: string;
  } | null;
  subject: string;
  text: string;
  html: string | null;
  warnings: string[];
  /** custom.<key> variables found in this list (for the variable chips). */
  customVariables: string[];
};

export type StartCampaignResult = {
  campaign: CampaignDTO;
  /** Messages created by this Start (0 when everything already existed). */
  created: number;
  pending: number;
  skipped: number;
};

export type MessageDTO = {
  id: string;
  contactId: string;
  toEmail: string;
  status: MessageStatus;
  inboxId: string | null;
  inboxEmail: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  attempts: number;
  renderedSubject: string | null;
  templateName: string | null;
  repliedAt: string | null;
  /** Bounce report found in the sending mailbox (e.g. 5.7.708). */
  bounce: { code: string; message: string } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
};
