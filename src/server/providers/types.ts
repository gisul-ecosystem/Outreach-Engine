// The email provider interface (BUILD_PLAN section 7). Microsoft now, Google later — same interface.
import type { SendFormat } from "@/shared/enums";

export type { SendFormat };

/**
 * What to send. In "outlook" format Microsoft builds the email itself, so `messageId` and
 * `listUnsubscribe` are only used in "mime" format, and a follow-up is sent as a reply.
 */
export type SendInput = {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  /** HTML version. When missing, one is made from the text, so every email has both parts. */
  html?: string;
  /** Message-ID header, e.g. <uuid@domain>. A new one is made when missing. */
  messageId?: string;
  /** Message-ID of the email this one replies to (sets In-Reply-To + References). */
  inReplyTo?: string;
  /** Outlook format: the provider's id of the email this one replies to (found by inReplyTo if missing). */
  parentProviderMessageId?: string;
  /** Value of the List-Unsubscribe header, e.g. <mailto:me@x.com?subject=unsubscribe>. */
  listUnsubscribe?: string;
};

export type SendResult = {
  providerMessageId?: string;
  /** The Message-ID header the email was sent with (to link bounces and follow-ups back to it). */
  internetMessageId?: string;
  /** How the email was handed over. Missing = "mime" (providers written before formats existed). */
  format?: SendFormat;
  /** Outlook format: true when it went out as a reply in the first email's thread (subject "RE: …"). */
  threaded?: boolean;
};

/** An email found in the mailbox's Sent Items folder (to learn the Message-ID Microsoft gave it). */
export type SentEmail = {
  id: string;
  internetMessageId: string;
  subject: string;
  to: string[];
  sentAt: Date;
};

/** An email in Sent Items with every recipient (to track emails sent by hand from Outlook). */
export type SentItem = {
  id: string;
  internetMessageId: string;
  conversationId: string | null;
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
  sentAt: Date;
  /** Tracking-link tokens (…/r/<token>) found in the body. The body itself is not kept. */
  linkTokens: string[];
};

/** One page run of Sent Items, oldest first. `complete` = false when the page cap was hit (more remain). */
export type SentItemsPage = { items: SentItem[]; complete: boolean };

export type CheckResult = { ok: boolean; error?: string };

/** A mailbox found in the provider's directory (e.g. a Microsoft 365 user). */
export type MailboxInfo = { email: string; displayName: string; enabled: boolean };

/** An email that arrived in a mailbox's Inbox folder (used to find bounces and replies). */
export type ReceivedEmail = {
  id: string;
  receivedAt: Date;
  fromEmail: string;
  fromName: string;
  subject: string;
  /** Full body as plain text (bounce reports keep the original headers here). */
  body: string;
  /** Only the new part of a reply, without the quoted earlier email. */
  uniqueBody: string;
  /** Graph's thread id: a reply has the same one as the email it answers. */
  conversationId?: string | null;
};

export interface EmailProvider {
  verifyConnection(): Promise<CheckResult>;
  verifyMailbox(email: string): Promise<CheckResult>;
  /** Lists the mailboxes on a domain. Read-only: never sends anything. */
  listMailboxes(domain: string): Promise<MailboxInfo[]>;
  /** Emails that arrived in the mailbox's Inbox since `since` (newest first). Read-only. */
  listReceivedEmails(mailbox: string, since: Date): Promise<ReceivedEmail[]>;
  /** Emails in the mailbox's Sent Items folder sent since `since` (newest first). Read-only. */
  listSentEmails?(mailbox: string, since: Date): Promise<SentEmail[]>;
  /** Sent Items sent from `since` up to `until`, OLDEST first, with To/CC/BCC. Read-only. */
  listSentItems?(mailbox: string, since: Date, until: Date): Promise<SentItemsPage>;
  /** Application permissions granted to the app (e.g. ["Mail.Send", "Mail.Read"]); null = unknown. */
  grantedPermissions?(): Promise<string[] | null>;
  send(input: SendInput): Promise<SendResult>;
}

/**
 * How the sender should react to a failed send (BUILD_PLAN section 6):
 * - transient: try again later (429, 5xx, timeouts) — respect retryAfterSeconds
 * - permanent: never retry this message (bad recipient, rejected message)
 * - auth:      credentials/permissions problem — affects every inbox on this connection
 */
export type ProviderErrorKind = "transient" | "permanent" | "auth";

export class ProviderError extends Error {
  /** HTTP status from Microsoft Graph, when there was a response. */
  public readonly status?: number;
  /** From the Retry-After header (transient errors only). */
  public readonly retryAfterSeconds?: number;
  /** The recipient address does not exist → add to suppressions as "bounced" (Phase 6). */
  public readonly invalidRecipient: boolean;

  constructor(
    public readonly kind: ProviderErrorKind,
    public readonly code: string,
    message: string,
    details: { status?: number; retryAfterSeconds?: number; invalidRecipient?: boolean } = {},
  ) {
    super(message);
    this.name = "ProviderError";
    this.status = details.status;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.invalidRecipient = details.invalidRecipient ?? false;
  }
}
