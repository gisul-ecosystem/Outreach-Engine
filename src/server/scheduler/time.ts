// Pure time helpers for send windows and ETA (no database). All inputs and outputs are UTC `Date`s;
// `tz` is an IANA timezone like "Asia/Kolkata" that decides what "today", "Monday" and "10:00" mean.
import { DateTime } from "luxon";

export type SendWindow = {
  /** Minutes after midnight, e.g. 600 = 10:00. */
  startMinute: number;
  /** Minutes after midnight (exclusive), e.g. 1080 = 18:00. 1440 = midnight at the end of the day. */
  endMinute: number;
  /** 1 = Monday … 7 = Sunday. */
  days: readonly number[];
};

/** How far ahead we look for the next window day (one full week + today). */
const SEARCH_DAYS = 8;
/** Safety cap for ETA estimates (about 10 years). */
const MAX_ETA_DAYS = 3660;

const local = (date: Date, tz: string) => DateTime.fromJSDate(date, { zone: tz });

/** A window is usable when it has at least one day and starts before it ends. */
export function isValidWindow(window: SendWindow): boolean {
  return window.days.length > 0 && window.startMinute < window.endMinute;
}

/** Window length in minutes (0 for an invalid window). */
export function windowMinutes(window: SendWindow): number {
  return isValidWindow(window) ? window.endMinute - window.startMinute : 0;
}

/** Midnight at the start of `date`'s day in `tz`, as a UTC Date. */
export function startOfDayInTz(date: Date, tz: string): Date {
  return local(date, tz).startOf("day").toJSDate();
}

/** The given minute-of-day on `day`'s calendar date in `tz` (1440 = next midnight). */
function atMinute(day: DateTime, minute: number): DateTime {
  return day.startOf("day").plus({ minutes: minute });
}

/** True when `date` is on a window day and between start (inclusive) and end (exclusive). */
export function isInsideWindow(date: Date, window: SendWindow, tz: string): boolean {
  if (!isValidWindow(window)) return false;
  const t = local(date, tz);
  if (!window.days.includes(t.weekday)) return false;
  const minute = t.hour * 60 + t.minute + t.second / 60 + t.millisecond / 60000;
  return minute >= window.startMinute && minute < window.endMinute;
}

/**
 * The earliest moment at or after `date` that is inside the window:
 * `date` itself when it is already inside, otherwise the next window start.
 * Returns null when the window has no days or no length.
 */
export function nextWindowStart(date: Date, window: SendWindow, tz: string): Date | null {
  if (!isValidWindow(window)) return null;
  if (isInsideWindow(date, window, tz)) return date;
  const now = local(date, tz);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    const day = now.plus({ days: i });
    if (!window.days.includes(day.weekday)) continue;
    const start = atMinute(day, window.startMinute);
    if (start >= now) return start.toJSDate();
  }
  return null;
}

/** End of the window on `date`'s calendar day in `tz` (whether or not it is a window day). */
export function windowEndOnDay(date: Date, window: SendWindow, tz: string): Date {
  return atMinute(local(date, tz), window.endMinute).toJSDate();
}

/**
 * When will `remaining` emails be sent if `dailyCapacity` can go out per window day?
 * (BUILD_PLAN section 6: remaining ÷ daily capacity → sending days → calendar dates via `days`.)
 *
 * Today counts only if it is a window day and the window has not ended; if the window is already
 * running, only the part that is left is counted (e.g. half the window left → half the capacity).
 * Returns the end of the window on the last sending day, `now` when nothing is left,
 * or null when it can never finish (no capacity or an unusable window).
 */
export function estimateFinishDate(
  remaining: number,
  dailyCapacity: number,
  window: SendWindow,
  tz: string,
  now: Date = new Date(),
): Date | null {
  if (remaining <= 0) return now;
  if (dailyCapacity <= 0 || !isValidWindow(window)) return null;

  let left = remaining;
  const today = local(now, tz);
  for (let i = 0; i < MAX_ETA_DAYS; i++) {
    const day = today.plus({ days: i });
    if (!window.days.includes(day.weekday)) continue;

    const start = atMinute(day, window.startMinute);
    const end = atMinute(day, window.endMinute);
    let capacity = dailyCapacity;
    if (i === 0) {
      if (today >= end) continue; // today's window is over
      if (today > start) {
        const fractionLeft = end.diff(today, "minutes").minutes / windowMinutes(window);
        capacity = Math.floor(dailyCapacity * fractionLeft);
      }
    }
    left -= capacity;
    if (left <= 0) return end.toJSDate();
  }
  return null;
}
