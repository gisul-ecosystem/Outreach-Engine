// Where a tracking link may send people. Checked when a link is CREATED and again on every click,
// so the engine can never be used as an "open redirect" (a link on our domain that forwards to any
// site — scammers use those to make a fake login page look like it came from us).

/**
 * The cleaned-up destination when it is allowed (https + host on the list + no user:password@),
 * otherwise null.
 */
export function allowedDestination(url: string, allowedHosts: readonly string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== "443") return null;
  if (!allowedHosts.includes(parsed.hostname.toLowerCase())) return null;
  return parsed.toString();
}
