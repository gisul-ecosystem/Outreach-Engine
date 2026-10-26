import { z } from "zod";
import { objectIdSchema, paginationSchema } from "./common";
import type { ClickVerdict, TrackedEmailSource } from "./enums";

/** `POST /api/contacts/[id]/links` — get this contact's link to a destination (or a fresh one). */
export const createLinkSchema = z.object({
  /** Must be https and on TRACKING_ALLOWED_HOSTS (checked on the server). */
  destinationUrl: z.url({ message: "Enter a full address, e.g. https://racko.ai/pricing" }),
  /** The words shown for the link when it is pasted into Outlook. */
  label: z.string().trim().max(200, "Too long").default(""),
  /** true = always make a new link instead of reusing the existing one. */
  new: z.boolean().default(false),
});
export type CreateLinkInput = z.input<typeof createLinkSchema>;

/** `GET /api/lists/[id]/links.csv?destinationUrl=…` */
export const linksCsvQuerySchema = z.object({
  destinationUrl: z.url().optional(),
});

export const CLICK_FILTERS = ["real", "real-and-maybe", "all"] as const;
export type ClickFilter = (typeof CLICK_FILTERS)[number];

/** `GET /api/tracking/clicks?include=real&from=…&to=…&inboxId=…&contactId=…` */
export const listClicksQuerySchema = paginationSchema.extend({
  /** real = real people only; real-and-maybe = also "maybe a bot"; all = bots too. */
  include: z.enum(CLICK_FILTERS).default("real"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Only clicks on links that were emailed from this inbox. */
  inboxId: objectIdSchema.optional(),
  contactId: objectIdSchema.optional(),
});
export type ListClicksQuery = z.infer<typeof listClicksQuerySchema>;

export type TrackingConfigDTO = {
  /** Start of every link, e.g. https://go.racko.ai */
  baseUrl: string;
  /** true when links only work on this computer (localhost or not https). */
  isLocal: boolean;
  /** Preset destination "Homepage". */
  homepage: string;
  allowedHosts: string[];
};

export type TrackedLinkDTO = {
  id: string;
  token: string;
  /** The full tracking link to paste into an email. */
  url: string;
  destinationUrl: string;
  label: string;
  createdAt: string;
  /** Hand-sent emails it was found in. */
  sentCount: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
  clickCount: number;
  realClickCount: number;
  firstRealClickAt: string | null;
  lastClickAt: string | null;
};

export type LinkClickDTO = {
  id: string;
  at: string;
  verdict: ClickVerdict;
  /** Plain-English reasons for the verdict. */
  reasons: string[];
  method: string;
  userAgent: string;
  destinationUrl: string;
  contact: { id: string; email: string; name: string } | null;
};

export type TimelineItemDTO =
  | {
      type: "sent";
      at: string;
      subject: string;
      inboxEmail: string;
      source: TrackedEmailSource;
      /** Someone else's link was pasted into this email. */
      wrongLink: boolean;
    }
  | { type: "replied"; at: string; subject: string; from: string }
  | { type: "click"; at: string; verdict: ClickVerdict; reasons: string[]; destinationUrl: string };

/** Plain-English label per verdict, for badges. */
export const VERDICT_LABELS: Record<ClickVerdict, string> = {
  click: "Real click",
  suspicious: "Maybe a bot",
  bot: "Bot",
};
