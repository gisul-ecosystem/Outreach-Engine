// Allowed values for every status / type field (BUILD_PLAN section 4 and 5).
// Safe to import from both client and server code.

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PROVIDER_TYPES = ["microsoft", "google", "zeptomail"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

/**
 * ZeptoMail data centre a connection's account lives in (its API host is api.zeptomail.<region>).
 * An account only works with its own region's host.
 */
export const ZEPTO_REGIONS = ["in", "com", "eu", "com.au"] as const;
export type ZeptoRegion = (typeof ZEPTO_REGIONS)[number];
export const DEFAULT_ZEPTO_REGION: ZeptoRegion = "in";

export const PROVIDER_STATUSES = ["connected", "error", "unchecked"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

/**
 * How emails are handed to Microsoft (set per provider connection):
 * - outlook: JSON — Microsoft builds the email exactly like Outlook does (default)
 * - mime:    the engine builds the raw email itself (the older way)
 */
export const SEND_FORMATS = ["outlook", "mime"] as const;
export type SendFormat = (typeof SEND_FORMATS)[number];
export const DEFAULT_SEND_FORMAT: SendFormat = "outlook";

export const DOMAIN_STATUSES = ["active", "paused"] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export const DNS_CHECK_RESULTS = ["pass", "fail", "unknown"] as const;
export type DnsCheckResult = (typeof DNS_CHECK_RESULTS)[number];

export const INBOX_STATUSES = ["active", "paused", "error"] as const;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const CONTACT_STATUSES = ["active", "unsubscribed", "bounced"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const SUPPRESSION_REASONS = ["unsubscribed", "bounced", "manual", "complaint"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const CAMPAIGN_STATUSES = ["draft", "running", "paused", "completed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const MESSAGE_STATUSES = [
  "pending",
  "scheduled",
  "sending",
  "sent",
  "failed",
  "skipped",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Who sent an email found in an inbox's Sent Items folder:
 * - manual: typed by hand in Outlook (no engine message matches it)
 * - engine: sent by the worker for a campaign
 */
export const TRACKED_EMAIL_SOURCES = ["manual", "engine"] as const;
export type TrackedEmailSource = (typeof TRACKED_EMAIL_SOURCES)[number];

/**
 * What an email that arrived in an inbox's Inbox folder is:
 * - reply:      from someone we emailed (campaign or by hand)
 * - bounce:     a delivery failure report ("Undeliverable…")
 * - auto_reply: out-of-office / automatic reply
 * - other:      anything else (newsletters, internal mail, strangers)
 */
export const INCOMING_EMAIL_KINDS = ["reply", "bounce", "auto_reply", "other"] as const;
export type IncomingEmailKind = (typeof INCOMING_EMAIL_KINDS)[number];

/**
 * What a tracking-link click was judged to be:
 * - click:      looks like a real person
 * - suspicious: maybe a bot (too fast after sending, a burst, missing browser details)
 * - bot:        certainly not a person (HEAD request, script, known scanner / link preview)
 */
export const CLICK_VERDICTS = ["click", "suspicious", "bot"] as const;
export type ClickVerdict = (typeof CLICK_VERDICTS)[number];

/** Defaults from BUILD_PLAN section 4 / 11. */
export const DEFAULTS = {
  timezone: "Asia/Kolkata",
  /** Warm-up for a new domain (was 30). Raise it slowly per inbox once emails are delivered fine. */
  dailyLimit: 10,
  minGapSeconds: 480,
  maxGapSeconds: 900,
  /** Mon–Fri 10:00–18:00 (minutes after midnight, days 1 = Monday … 7 = Sunday) */
  sendWindow: { startMinute: 600, endMinute: 1080, days: [1, 2, 3, 4, 5] },
} as const;
