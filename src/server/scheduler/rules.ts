// Pure scheduler rules (no database, no clock): everything the planner and sender decide with.
// BUILD_PLAN section 6. Times are UTC `Date`s; `tz` is the app timezone.
import { DateTime } from "luxon";
import { ProviderError } from "@/server/providers/types";
import { isInsideWindow, nextWindowStart, type SendWindow } from "./time";

/** Random whole number of seconds from min to max (both included). `random` is injectable for tests. */
export function randomGapSeconds(min: number, max: number, random: () => number = Math.random) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  if (high <= low) return low;
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * When may this inbox send its next email? `max(now, lastSentAt + gap)`, moved forward to the window start
 * if that is earlier. Returns null when that moment is not inside today's window (past its end, or today
 * is not a window day) — the inbox is finished for today.
 */
export function computeNextSendAt(
  now: Date,
  lastSentAt: Date | null | undefined,
  gapSeconds: number,
  window: SendWindow,
  tz: string,
): Date | null {
  const afterGap = lastSentAt ? new Date(lastSentAt.getTime() + gapSeconds * 1000) : now;
  const candidate = afterGap > now ? afterGap : now;
  const next = nextWindowStart(candidate, window, tz);
  if (!next) return null;
  const sameDay = DateTime.fromJSDate(next, { zone: tz }).hasSame(
    DateTime.fromJSDate(now, { zone: tz }),
    "day",
  );
  return sameDay ? next : null;
}

export type InboxRuleInput = { status: string; dailyLimit: number; deletedAt?: Date | null };
export type DomainRuleInput = { status: string; deletedAt?: Date | null };
export type ConnectionRuleInput = { status: string; deletedAt?: Date | null };

export type CanSendReason =
  | "inbox_unavailable" // missing, deleted, or not active
  | "domain_unavailable" // missing, deleted, or paused
  | "connection_unavailable" // missing, deleted, or not connected
  | "outside_window"
  | "in_flight" // already has a scheduled/sending message
  | "daily_limit_reached";

/**
 * BUILD_PLAN section 6, planner rules 1–4, in order. `requireConnected: false` is for DRY_RUN, where the
 * FakeProvider needs no real Microsoft connection.
 */
export function canInboxSendNow(
  inbox: InboxRuleInput | null | undefined,
  domain: DomainRuleInput | null | undefined,
  connection: ConnectionRuleInput | null | undefined,
  sentTodayCount: number,
  hasInFlight: boolean,
  now: Date,
  window: SendWindow,
  tz: string,
  options: { requireConnected?: boolean } = {},
): { ok: true } | { ok: false; reason: CanSendReason } {
  const requireConnected = options.requireConnected ?? true;
  if (!inbox || inbox.deletedAt || inbox.status !== "active") {
    return { ok: false, reason: "inbox_unavailable" };
  }
  if (!domain || domain.deletedAt || domain.status !== "active") {
    return { ok: false, reason: "domain_unavailable" };
  }
  if (
    requireConnected &&
    (!connection || connection.deletedAt || connection.status !== "connected")
  ) {
    return { ok: false, reason: "connection_unavailable" };
  }
  if (!isInsideWindow(now, window, tz)) return { ok: false, reason: "outside_window" };
  if (hasInFlight) return { ok: false, reason: "in_flight" };
  if (sentTodayCount >= inbox.dailyLimit) return { ok: false, reason: "daily_limit_reached" };
  return { ok: true };
}

export const MAX_ATTEMPTS = 3;
/** Wait before the next try, by how many attempts have failed so far: 1 minute, 5 minutes, 15 minutes. */
export const BACKOFF_SECONDS = [60, 5 * 60, 15 * 60] as const;
/** A server asking us to wait longer than this is ignored beyond the cap (the message can be retried by a human). */
const MAX_RETRY_AFTER_SECONDS = 60 * 60;

export type RetryDecision =
  | { action: "retry"; retryAt: Date }
  | { action: "fail" | "fail_and_suppress" | "fail_and_pause_connection"; retryAt: null };

/**
 * What to do after a failed send (BUILD_PLAN section 6, sender step 6).
 * `attempts` = how many sends have been tried so far, including the one that just failed.
 * - transient: retry after the backoff (or the provider's Retry-After, whichever is longer); fail after 3 attempts
 * - permanent: fail; when the address does not exist also suppress it as "bounced"
 * - auth: fail and pause the connection
 */
export function classifyRetry(
  attempts: number,
  error: ProviderError,
  now: Date = new Date(),
): RetryDecision {
  if (error.kind === "auth") return { action: "fail_and_pause_connection", retryAt: null };
  if (error.kind === "permanent") {
    return { action: error.invalidRecipient ? "fail_and_suppress" : "fail", retryAt: null };
  }
  if (attempts >= MAX_ATTEMPTS) return { action: "fail", retryAt: null };

  const backoff = BACKOFF_SECONDS[Math.min(Math.max(attempts, 1), BACKOFF_SECONDS.length) - 1];
  const retryAfter = Math.min(error.retryAfterSeconds ?? 0, MAX_RETRY_AFTER_SECONDS);
  return {
    action: "retry",
    retryAt: new Date(now.getTime() + Math.max(backoff, retryAfter) * 1000),
  };
}

export type ContactForSend = { status: string; deletedAt?: Date | null } | null | undefined;

/**
 * Why this contact must NOT be emailed (null = fine to send). Checked by the planner before scheduling
 * and again by the sender right before sending (CLAUDE.md safety rule).
 */
export function contactBlockReason(
  contact: ContactForSend,
  isSuppressed: boolean,
): { code: string; message: string } | null {
  if (isSuppressed) return { code: "SUPPRESSED", message: "The email is on the suppression list" };
  if (!contact || contact.deletedAt) {
    return { code: "CONTACT_DELETED", message: "The contact was deleted" };
  }
  if (contact.status === "bounced") return { code: "BOUNCED", message: "The contact has bounced" };
  if (contact.status !== "active") {
    return { code: "UNSUBSCRIBED", message: "The contact unsubscribed" };
  }
  return null;
}
