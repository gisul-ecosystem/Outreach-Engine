import { z } from "zod";
import { objectIdSchema, paginationSchema } from "./common";
import { TRACKED_EMAIL_SOURCES, type TrackedEmailSource } from "./enums";

/** "manual" = typed by hand in Outlook, "engine" = sent by the worker, "all" = both. */
export const TRACKED_SOURCE_FILTERS = [...TRACKED_EMAIL_SOURCES, "all"] as const;
export type TrackedSourceFilter = (typeof TRACKED_SOURCE_FILTERS)[number];

export const TRACKING_PERIODS = ["day", "week", "month"] as const;
export type TrackingPeriod = (typeof TRACKING_PERIODS)[number];

const filtersSchema = z.object({
  source: z.enum(TRACKED_SOURCE_FILTERS).default("manual"),
  inboxId: objectIdSchema.optional(),
});

/** `GET /api/sent-emails?page=1&limit=25&source=manual&inboxId=…&search=…&from=…&to=…` */
export const listTrackedEmailsQuerySchema = paginationSchema.extend({
  ...filtersSchema.shape,
  /** Part of a recipient address or of the subject. */
  search: z.string().trim().max(254).optional(),
  /** Sent at or after this moment (ISO). */
  from: z.coerce.date().optional(),
  /** Sent before this moment (ISO). */
  to: z.coerce.date().optional(),
  /** Only emails that contain someone else's tracking link. */
  wrongLinksOnly: z.stringbool().optional(),
});
export type ListTrackedEmailsQuery = z.infer<typeof listTrackedEmailsQuerySchema>;

/** `GET /api/sent-emails/stats?period=day&count=14&source=manual&inboxId=…` */
export const trackedStatsQuerySchema = filtersSchema.extend({
  period: z.enum(TRACKING_PERIODS).default("day"),
  /** How many days / weeks / months to show, ending with the current one. */
  count: z.coerce.number().int().min(1).max(90).default(14),
});
export type TrackedStatsQuery = z.infer<typeof trackedStatsQuerySchema>;

/** Emails sent and the number of different people they went to. */
export type SentCountDTO = { emails: number; people: number };

export type TrackedStatsDTO = {
  timezone: string;
  today: SentCountDTO;
  /** Since Monday 00:00 in the app timezone. */
  thisWeek: SentCountDTO;
  thisMonth: SentCountDTO;
  /** One bar per day / week / month, oldest first; `from`–`to` is that period (ISO, `to` excluded). */
  buckets: (SentCountDTO & { label: string; from: string; to: string })[];
  /** Emails (any time, any filter) that contain someone else's tracking link. */
  wrongLinkEmails: number;
  /** Inboxes the tracker reads, with the moment their Sent Items were last read (null = not yet). */
  inboxes: { id: string; email: string; checkedAt: string | null }[];
};

export type TrackedEmailDTO = {
  id: string;
  inboxEmail: string;
  source: TrackedEmailSource;
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
  /** Recipients that are contacts in the engine. */
  contacts: { id: string; email: string; name: string }[];
  sentAt: string;
  repliedAt: string | null;
  replyFromEmail: string | null;
  /** Opens of the tracking links found in this email (real = judged a real person). */
  clicks: { total: number; real: number };
  /** Links of people who are NOT recipients of this email (pasted into the wrong email). */
  wrongLinks: { token: string; ownerEmail: string; ownerName: string }[];
};
