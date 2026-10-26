// A simple in-memory rate limit for the public link route: at most LIMIT opens per visitor per minute.
// Over the limit the person is still redirected; the click is just not saved (stops someone filling the
// database). In memory = per server process and forgotten on restart, which is fine for this purpose.

export const RATE_LIMIT = 30;
export const RATE_WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;

const windows = new Map<string, { start: number; count: number }>();

/** true = allowed (and counted), false = over the limit. */
export function allowClick(key: string, now = Date.now()): boolean {
  const current = windows.get(key);
  if (!current || now - current.start >= RATE_WINDOW_MS) {
    if (windows.size >= MAX_KEYS) prune(now);
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count++;
  return current.count <= RATE_LIMIT;
}

function prune(now: number) {
  for (const [key, w] of windows) if (now - w.start >= RATE_WINDOW_MS) windows.delete(key);
  if (windows.size >= MAX_KEYS) windows.clear();
}

/** Tests only. */
export function resetRateLimit() {
  windows.clear();
}
