// The email provider interface (BUILD_PLAN section 7). Microsoft now, Google later — same interface.

export type SendInput = {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export type SendResult = { providerMessageId?: string };

export type CheckResult = { ok: boolean; error?: string };

/** A mailbox found in the provider's directory (e.g. a Microsoft 365 user). */
export type MailboxInfo = { email: string; displayName: string; enabled: boolean };

export interface EmailProvider {
  verifyConnection(): Promise<CheckResult>;
  verifyMailbox(email: string): Promise<CheckResult>;
  /** Lists the mailboxes on a domain. Read-only: never sends anything. */
  listMailboxes(domain: string): Promise<MailboxInfo[]>;
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
