import { describe, expect, it } from "vitest";
import { ProviderError } from "@/server/providers/types";
import {
  canInboxSendNow,
  classifyRetry,
  computeNextSendAt,
  randomGapSeconds,
} from "@/server/scheduler/rules";
import type { SendWindow } from "@/server/scheduler/time";

const IST = "Asia/Kolkata";
const WORKDAYS: SendWindow = { startMinute: 600, endMinute: 1080, days: [1, 2, 3, 4, 5] };
// 2026-10-20 is a Tuesday. 10:00 IST = 04:30Z, 18:00 IST = 12:30Z.
const at = (iso: string) => new Date(iso);
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("randomGapSeconds", () => {
  it("stays inside min..max and is a whole number", () => {
    for (let i = 0; i < 500; i++) {
      const gap = randomGapSeconds(10, 20);
      expect(gap).toBeGreaterThanOrEqual(10);
      expect(gap).toBeLessThanOrEqual(20);
      expect(Number.isInteger(gap)).toBe(true);
    }
  });

  it("can return both ends", () => {
    expect(randomGapSeconds(10, 20, () => 0)).toBe(10);
    expect(randomGapSeconds(10, 20, () => 0.999999)).toBe(20);
  });

  it("handles min = max and swapped arguments", () => {
    expect(randomGapSeconds(15, 15)).toBe(15);
    expect(randomGapSeconds(20, 10, () => 0)).toBe(10);
  });
});

describe("computeNextSendAt", () => {
  const now = at("2026-10-20T06:00:00Z"); // 11:30 IST

  it("is now when the inbox never sent", () => {
    expect(iso(computeNextSendAt(now, null, 600, WORKDAYS, IST))).toBe(now.toISOString());
  });

  it("is lastSentAt + gap when that is in the future", () => {
    const last = at("2026-10-20T05:59:00Z");
    expect(iso(computeNextSendAt(now, last, 120, WORKDAYS, IST))).toBe("2026-10-20T06:01:00.000Z");
  });

  it("is now when the gap has already passed", () => {
    const last = at("2026-10-20T05:00:00Z");
    expect(iso(computeNextSendAt(now, last, 120, WORKDAYS, IST))).toBe(now.toISOString());
  });

  it("is null when lastSentAt + gap is past today's window end", () => {
    const lateNow = at("2026-10-20T12:25:00Z"); // 17:55 IST
    const last = at("2026-10-20T12:24:00Z");
    expect(computeNextSendAt(lateNow, last, 600, WORKDAYS, IST)).toBeNull();
  });

  it("is null exactly at the window end (end is exclusive)", () => {
    expect(computeNextSendAt(at("2026-10-20T12:30:00Z"), null, 0, WORKDAYS, IST)).toBeNull();
  });

  it("moves forward to the window start when called before the window opens", () => {
    const early = at("2026-10-20T03:00:00Z"); // 08:30 IST
    expect(iso(computeNextSendAt(early, null, 0, WORKDAYS, IST))).toBe("2026-10-20T04:30:00.000Z");
  });

  it("is null on a day that is not a window day", () => {
    const saturday = at("2026-10-24T06:00:00Z");
    expect(computeNextSendAt(saturday, null, 0, WORKDAYS, IST)).toBeNull();
  });

  it("is null when the gap would carry the send into the next day", () => {
    const last = at("2026-10-20T12:29:00Z");
    expect(computeNextSendAt(at("2026-10-20T12:29:30Z"), last, 8 * 3600, WORKDAYS, IST)).toBeNull();
  });

  it("uses the app timezone for 'today'", () => {
    // 2026-10-20 20:30Z is already 02:00 on the 21st in IST, a different day from 'now' in UTC terms.
    const allDay: SendWindow = { startMinute: 0, endMinute: 1440, days: [1, 2, 3, 4, 5, 6, 7] };
    const lateUtc = at("2026-10-20T18:00:00Z"); // 23:30 IST on the 20th
    const last = at("2026-10-20T17:59:00Z");
    // +1 h gap crosses IST midnight → tomorrow → null
    expect(computeNextSendAt(lateUtc, last, 3600, allDay, IST)).toBeNull();
    // +10 min stays on the 20th
    expect(iso(computeNextSendAt(lateUtc, last, 600, allDay, IST))).toBe(
      "2026-10-20T18:09:00.000Z",
    );
  });
});

describe("canInboxSendNow", () => {
  const inbox = { status: "active", dailyLimit: 5 };
  const domain = { status: "active" };
  const connection = { status: "connected" };
  const now = at("2026-10-20T06:00:00Z"); // Tuesday 11:30 IST
  const check = (
    overrides: Partial<{
      inbox: typeof inbox | null;
      domain: { status: string; deletedAt?: Date | null } | null;
      connection: { status: string; deletedAt?: Date | null } | null;
      sent: number;
      inFlight: boolean;
      now: Date;
      requireConnected: boolean;
    }> = {},
  ) =>
    canInboxSendNow(
      "inbox" in overrides ? overrides.inbox : inbox,
      "domain" in overrides ? overrides.domain : domain,
      "connection" in overrides ? overrides.connection : connection,
      overrides.sent ?? 0,
      overrides.inFlight ?? false,
      overrides.now ?? now,
      WORKDAYS,
      IST,
      { requireConnected: overrides.requireConnected },
    );

  it("is ok when everything is fine", () => {
    expect(check()).toEqual({ ok: true });
  });

  it("refuses a missing, deleted, paused or errored inbox", () => {
    expect(check({ inbox: null })).toEqual({ ok: false, reason: "inbox_unavailable" });
    expect(check({ inbox: { ...inbox, status: "paused" } })).toEqual({
      ok: false,
      reason: "inbox_unavailable",
    });
    expect(check({ inbox: { ...inbox, status: "error" } })).toEqual({
      ok: false,
      reason: "inbox_unavailable",
    });
    expect(check({ inbox: { ...inbox, deletedAt: new Date() } as typeof inbox })).toEqual({
      ok: false,
      reason: "inbox_unavailable",
    });
  });

  it("refuses a deleted, paused or missing domain", () => {
    expect(check({ domain: { status: "paused" } })).toEqual({
      ok: false,
      reason: "domain_unavailable",
    });
    expect(check({ domain: { status: "active", deletedAt: new Date() } })).toEqual({
      ok: false,
      reason: "domain_unavailable",
    });
    expect(check({ domain: null })).toEqual({ ok: false, reason: "domain_unavailable" });
  });

  it("refuses a connection that is not connected (unless dry run)", () => {
    expect(check({ connection: { status: "error" } })).toEqual({
      ok: false,
      reason: "connection_unavailable",
    });
    expect(check({ connection: null })).toEqual({ ok: false, reason: "connection_unavailable" });
    expect(check({ connection: { status: "unchecked" }, requireConnected: false })).toEqual({
      ok: true,
    });
  });

  it("refuses outside the window (time and day)", () => {
    expect(check({ now: at("2026-10-20T13:00:00Z") })).toEqual({
      ok: false,
      reason: "outside_window",
    }); // 18:30 IST
    expect(check({ now: at("2026-10-24T06:00:00Z") })).toEqual({
      ok: false,
      reason: "outside_window",
    }); // Saturday
  });

  it("refuses when a message is already in flight", () => {
    expect(check({ inFlight: true })).toEqual({ ok: false, reason: "in_flight" });
  });

  it("refuses at the daily limit, allows one below it", () => {
    expect(check({ sent: 4 })).toEqual({ ok: true });
    expect(check({ sent: 5 })).toEqual({ ok: false, reason: "daily_limit_reached" });
    expect(check({ sent: 9 })).toEqual({ ok: false, reason: "daily_limit_reached" });
  });
});

describe("classifyRetry", () => {
  const now = at("2026-10-20T06:00:00Z");
  const transient = (retryAfterSeconds?: number) =>
    new ProviderError("transient", "HTTP_429", "slow down", { retryAfterSeconds });
  const secondsLater = (decision: ReturnType<typeof classifyRetry>) =>
    decision.retryAt ? (decision.retryAt.getTime() - now.getTime()) / 1000 : null;

  it("backs off 1 minute, then 5 minutes, then 15 minutes", () => {
    expect(secondsLater(classifyRetry(1, transient(), now))).toBe(60);
    expect(secondsLater(classifyRetry(2, transient(), now))).toBe(300);
  });

  it("fails after the 3rd attempt", () => {
    expect(classifyRetry(3, transient(), now)).toEqual({ action: "fail", retryAt: null });
    expect(classifyRetry(4, transient(), now)).toEqual({ action: "fail", retryAt: null });
  });

  it("honours a longer Retry-After but never retries sooner than the backoff", () => {
    expect(secondsLater(classifyRetry(1, transient(240), now))).toBe(240);
    expect(secondsLater(classifyRetry(2, transient(10), now))).toBe(300);
  });

  it("caps an absurd Retry-After at one hour", () => {
    expect(secondsLater(classifyRetry(1, transient(999_999), now))).toBe(3600);
  });

  it("fails permanent errors at once", () => {
    const error = new ProviderError("permanent", "HTTP_400", "bad request");
    expect(classifyRetry(1, error, now)).toEqual({ action: "fail", retryAt: null });
  });

  it("fails and suppresses an address that does not exist", () => {
    const error = new ProviderError("permanent", "INVALID_RECIPIENT", "no such user", {
      invalidRecipient: true,
    });
    expect(classifyRetry(1, error, now)).toEqual({ action: "fail_and_suppress", retryAt: null });
  });

  it("fails and pauses the connection on auth errors", () => {
    const error = new ProviderError("auth", "HTTP_401", "unauthorized");
    expect(classifyRetry(1, error, now)).toEqual({
      action: "fail_and_pause_connection",
      retryAt: null,
    });
  });
});
