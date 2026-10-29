import { z } from "zod";
import { objectIdSchema, paginationSchema } from "./common";
import { INCOMING_EMAIL_KINDS, type IncomingEmailKind } from "./enums";

export const INCOMING_KIND_FILTERS = [...INCOMING_EMAIL_KINDS, "all"] as const;
export type IncomingKindFilter = (typeof INCOMING_KIND_FILTERS)[number];

/** `GET /api/incoming-emails?page=1&limit=25&kind=reply&inboxId=…&search=…` */
export const listIncomingEmailsQuerySchema = paginationSchema.extend({
  kind: z.enum(INCOMING_KIND_FILTERS).default("all"),
  inboxId: objectIdSchema.optional(),
  /** Part of the sender's address or name, or of the subject. */
  search: z.string().trim().max(254).optional(),
});
export type ListIncomingEmailsQuery = z.infer<typeof listIncomingEmailsQuerySchema>;

export type IncomingEmailDTO = {
  id: string;
  inboxId: string;
  inboxEmail: string;
  kind: IncomingEmailKind;
  fromEmail: string;
  fromName: string;
  subject: string;
  /** Start of the new text (the list shows this; the full email comes from GET /:id). */
  preview: string;
  receivedAt: string;
  campaign: { id: string; name: string } | null;
  contact: { id: string; email: string; name: string } | null;
};

export type IncomingEmailDetailDTO = IncomingEmailDTO & {
  /** Only the new part of a reply. */
  text: string;
  /** The whole email, quoted earlier emails included. */
  body: string;
};

export type IncomingEmailsPageDTO = {
  data: IncomingEmailDTO[];
  page: number;
  limit: number;
  total: number;
  /** How many emails of each kind match the inbox + search filters (for the filter buttons). */
  counts: Record<IncomingKindFilter, number>;
  /** Inboxes that are read, with the moment their Inbox folder was last read (null = not yet). */
  inboxes: { id: string; email: string; checkedAt: string | null }[];
};
