import { DateTime } from "luxon";

/** "3 minutes ago", "in 2 hours". Returns "Never" for null. */
export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "Never";
  return DateTime.fromISO(iso).toRelative() ?? "Never";
}

/** "20 Oct 2026, 14:05" in the browser's timezone (or in `zone` when given). */
export function formatDateTime(iso: string | null | undefined, zone?: string): string {
  if (!iso) return "—";
  const dt = DateTime.fromISO(iso);
  return (zone ? dt.setZone(zone) : dt).toLocaleString(DateTime.DATETIME_MED);
}

/** "Tue, 20 Oct 2026" in the given timezone (the app timezone for send windows and ETAs). */
export function formatDayInZone(iso: string | null | undefined, zone: string): string {
  if (!iso) return "—";
  return DateTime.fromISO(iso).setZone(zone).toFormat("ccc, d LLL yyyy");
}

/** Live countdown text: "in 3m 12s", "in 45s", "in 1h 5m", or "due now" once the time has passed. */
export function formatCountdown(targetIso: string | null | undefined, nowMs: number): string {
  if (!targetIso) return "—";
  const seconds = Math.ceil((new Date(targetIso).getTime() - nowMs) / 1000);
  if (seconds <= 0) return "due now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `in ${h}h ${m}m`;
  if (m > 0) return `in ${m}m ${s}s`;
  return `in ${s}s`;
}

/** "4 min ago" that follows the ticking clock (formatRelative uses the real clock). */
export function formatAgo(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return "Never";
  const seconds = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
