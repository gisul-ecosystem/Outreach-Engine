import { describe, expect, it } from "vitest";
import {
  estimateFinishDate,
  isInsideWindow,
  isValidWindow,
  nextWindowStart,
  startOfDayInTz,
  windowEndOnDay,
  type SendWindow,
} from "@/server/scheduler/time";

const IST = "Asia/Kolkata";
// Mon–Fri 10:00–18:00 (the default). 2026-10-20 is a Tuesday; 24/25 Oct is a weekend.
const WORKDAYS: SendWindow = { startMinute: 600, endMinute: 1080, days: [1, 2, 3, 4, 5] };
const ALL_DAY_EVERY_DAY: SendWindow = {
  startMinute: 0,
  endMinute: 1440,
  days: [1, 2, 3, 4, 5, 6, 7],
};

const at = (iso: string) => new Date(iso);
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("isValidWindow", () => {
  it("needs days and start < end", () => {
    expect(isValidWindow(WORKDAYS)).toBe(true);
    expect(isValidWindow({ ...WORKDAYS, days: [] })).toBe(false);
    expect(isValidWindow({ ...WORKDAYS, startMinute: 1080, endMinute: 600 })).toBe(false);
    expect(isValidWindow({ ...WORKDAYS, endMinute: 600 })).toBe(false);
  });
});

describe("isInsideWindow", () => {
  it("start is inclusive, end is exclusive", () => {
    expect(isInsideWindow(at("2026-10-20T10:00:00+05:30"), WORKDAYS, IST)).toBe(true);
    expect(isInsideWindow(at("2026-10-20T09:59:59+05:30"), WORKDAYS, IST)).toBe(false);
    expect(isInsideWindow(at("2026-10-20T17:59:59+05:30"), WORKDAYS, IST)).toBe(true);
    expect(isInsideWindow(at("2026-10-20T18:00:00+05:30"), WORKDAYS, IST)).toBe(false);
  });

  it("is false on weekends", () => {
    expect(isInsideWindow(at("2026-10-24T12:00:00+05:30"), WORKDAYS, IST)).toBe(false);
    expect(isInsideWindow(at("2026-10-25T12:00:00+05:30"), WORKDAYS, IST)).toBe(false);
  });

  it("uses the timezone, not UTC", () => {
    const tenAmIst = at("2026-10-20T04:30:00Z");
    expect(isInsideWindow(tenAmIst, WORKDAYS, IST)).toBe(true);
    expect(isInsideWindow(tenAmIst, WORKDAYS, "UTC")).toBe(false);
  });

  it("decides the weekday in the timezone (Friday night UTC is already Saturday in India)", () => {
    const fri19Utc = at("2026-10-23T19:00:00Z"); // Sat 00:30 IST
    const allDayWeekdays = { ...ALL_DAY_EVERY_DAY, days: [1, 2, 3, 4, 5] };
    expect(isInsideWindow(fri19Utc, allDayWeekdays, "UTC")).toBe(true);
    expect(isInsideWindow(fri19Utc, allDayWeekdays, IST)).toBe(false);
  });

  it("a window ending at 1440 includes the last second before midnight", () => {
    expect(isInsideWindow(at("2026-10-20T23:59:59+05:30"), ALL_DAY_EVERY_DAY, IST)).toBe(true);
    expect(isInsideWindow(at("2026-10-21T00:00:00+05:30"), ALL_DAY_EVERY_DAY, IST)).toBe(true);
  });

  it("is false for an invalid window", () => {
    expect(isInsideWindow(at("2026-10-20T12:00:00+05:30"), { ...WORKDAYS, days: [] }, IST)).toBe(
      false,
    );
  });
});

describe("startOfDayInTz", () => {
  it("returns local midnight as UTC", () => {
    // 01:30 on 21 Oct in India = 20:00 on 20 Oct in UTC
    const d = at("2026-10-20T20:00:00Z");
    expect(iso(startOfDayInTz(d, IST))).toBe("2026-10-20T18:30:00.000Z");
    expect(iso(startOfDayInTz(d, "UTC"))).toBe("2026-10-20T00:00:00.000Z");
  });

  it("is stable exactly at midnight", () => {
    expect(iso(startOfDayInTz(at("2026-10-21T00:00:00+05:30"), IST))).toBe(
      "2026-10-20T18:30:00.000Z",
    );
  });
});

describe("nextWindowStart", () => {
  it("returns the same moment when already inside", () => {
    const d = at("2026-10-20T12:34:56+05:30");
    expect(nextWindowStart(d, WORKDAYS, IST)).toBe(d);
  });

  it("before the window → today's start", () => {
    expect(iso(nextWindowStart(at("2026-10-20T08:00:00+05:30"), WORKDAYS, IST))).toBe(
      iso(at("2026-10-20T10:00:00+05:30")),
    );
  });

  it("at or after the end → tomorrow's start", () => {
    expect(iso(nextWindowStart(at("2026-10-20T18:00:00+05:30"), WORKDAYS, IST))).toBe(
      iso(at("2026-10-21T10:00:00+05:30")),
    );
    expect(iso(nextWindowStart(at("2026-10-20T23:59:00+05:30"), WORKDAYS, IST))).toBe(
      iso(at("2026-10-21T10:00:00+05:30")),
    );
  });

  it("just after midnight → that same day's start", () => {
    expect(iso(nextWindowStart(at("2026-10-21T00:01:00+05:30"), WORKDAYS, IST))).toBe(
      iso(at("2026-10-21T10:00:00+05:30")),
    );
  });

  it("Friday evening and the weekend → Monday's start", () => {
    const monday = iso(at("2026-10-26T10:00:00+05:30"));
    expect(iso(nextWindowStart(at("2026-10-23T18:30:00+05:30"), WORKDAYS, IST))).toBe(monday);
    expect(iso(nextWindowStart(at("2026-10-24T11:00:00+05:30"), WORKDAYS, IST))).toBe(monday);
    expect(iso(nextWindowStart(at("2026-10-25T23:00:00+05:30"), WORKDAYS, IST))).toBe(monday);
  });

  it("a single weekday after its window → one week later", () => {
    const wednesdays: SendWindow = { ...WORKDAYS, days: [3] };
    expect(iso(nextWindowStart(at("2026-10-21T19:00:00+05:30"), wednesdays, IST))).toBe(
      iso(at("2026-10-28T10:00:00+05:30")),
    );
  });

  it("follows daylight saving time changes (New York, 1 Nov 2026)", () => {
    const nineToFive: SendWindow = { startMinute: 540, endMinute: 1020, days: [1, 2, 3, 4, 5] };
    // Friday 30 Oct 18:00 EDT → Monday 2 Nov 09:00 EST (= 14:00 UTC, one hour later in UTC than before)
    expect(iso(nextWindowStart(at("2026-10-30T22:00:00Z"), nineToFive, "America/New_York"))).toBe(
      "2026-11-02T14:00:00.000Z",
    );
  });

  it("returns null for an invalid window", () => {
    expect(nextWindowStart(at("2026-10-20T08:00:00+05:30"), { ...WORKDAYS, days: [] }, IST)).toBe(
      null,
    );
  });
});

describe("windowEndOnDay", () => {
  it("is 18:00 on the same local day", () => {
    expect(iso(windowEndOnDay(at("2026-10-20T08:00:00+05:30"), WORKDAYS, IST))).toBe(
      iso(at("2026-10-20T18:00:00+05:30")),
    );
  });
});

describe("estimateFinishDate", () => {
  const tueEarly = at("2026-10-20T08:00:00+05:30");

  it("nothing left → now; no capacity or bad window → null", () => {
    expect(estimateFinishDate(0, 30, WORKDAYS, IST, tueEarly)).toBe(tueEarly);
    expect(estimateFinishDate(10, 0, WORKDAYS, IST, tueEarly)).toBeNull();
    expect(estimateFinishDate(10, 30, { ...WORKDAYS, days: [] }, IST, tueEarly)).toBeNull();
  });

  it("fits in today → end of today's window", () => {
    expect(iso(estimateFinishDate(30, 30, WORKDAYS, IST, tueEarly))).toBe(
      iso(at("2026-10-20T18:00:00+05:30")),
    );
  });

  it("one more than a day → tomorrow", () => {
    expect(iso(estimateFinishDate(31, 30, WORKDAYS, IST, tueEarly))).toBe(
      iso(at("2026-10-21T18:00:00+05:30")),
    );
  });

  it("skips weekends", () => {
    // Thu + Fri + Mon = 90
    expect(iso(estimateFinishDate(90, 30, WORKDAYS, IST, at("2026-10-22T08:00:00+05:30")))).toBe(
      iso(at("2026-10-26T18:00:00+05:30")),
    );
  });

  it("counts only the part of today's window that is left", () => {
    const tue14 = at("2026-10-20T14:00:00+05:30"); // half the window left → 15 today
    expect(iso(estimateFinishDate(15, 30, WORKDAYS, IST, tue14))).toBe(
      iso(at("2026-10-20T18:00:00+05:30")),
    );
    expect(iso(estimateFinishDate(45, 30, WORKDAYS, IST, tue14))).toBe(
      iso(at("2026-10-21T18:00:00+05:30")),
    );
    expect(iso(estimateFinishDate(46, 30, WORKDAYS, IST, tue14))).toBe(
      iso(at("2026-10-22T18:00:00+05:30")),
    );
  });

  it("after today's window (or on a weekend) starts counting from the next window day", () => {
    expect(iso(estimateFinishDate(10, 30, WORKDAYS, IST, at("2026-10-23T19:00:00+05:30")))).toBe(
      iso(at("2026-10-26T18:00:00+05:30")),
    );
    expect(iso(estimateFinishDate(10, 30, WORKDAYS, IST, at("2026-10-24T12:00:00+05:30")))).toBe(
      iso(at("2026-10-26T18:00:00+05:30")),
    );
  });

  it("works across midnight for an all-day window", () => {
    // 23:00 → 1/24 of the day left → floor(48/24) = 2 today, the rest tomorrow
    const lateNight = at("2026-10-20T23:00:00+05:30");
    expect(iso(estimateFinishDate(2, 48, ALL_DAY_EVERY_DAY, IST, lateNight))).toBe(
      iso(at("2026-10-21T00:00:00+05:30")),
    );
    expect(iso(estimateFinishDate(3, 48, ALL_DAY_EVERY_DAY, IST, lateNight))).toBe(
      iso(at("2026-10-22T00:00:00+05:30")),
    );
  });

  it("handles big numbers (1,000 emails at 30/day = 34 working days)", () => {
    // 34 working days from Tue 20 Oct: 20 Oct … 4 Dec (Fri)
    expect(iso(estimateFinishDate(1000, 30, WORKDAYS, IST, tueEarly))).toBe(
      iso(at("2026-12-04T18:00:00+05:30")),
    );
  });
});
