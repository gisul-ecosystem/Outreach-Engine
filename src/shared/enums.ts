// Allowed values for every status / type field (BUILD_PLAN section 4 and 5).
// Safe to import from both client and server code.

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PROVIDER_TYPES = ["microsoft", "google"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_STATUSES = ["connected", "error", "unchecked"] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

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

/** Defaults from BUILD_PLAN section 4 / 11. */
export const DEFAULTS = {
  timezone: "Asia/Kolkata",
  dailyLimit: 30,
  minGapSeconds: 480,
  maxGapSeconds: 900,
  /** Mon–Fri 10:00–18:00 (minutes after midnight, days 1 = Monday … 7 = Sunday) */
  sendWindow: { startMinute: 600, endMinute: 1080, days: [1, 2, 3, 4, 5] },
} as const;
