// "Can this domain receive email?" — an MX record says which server accepts its email.
// Checked right before a real send; results are remembered for an hour per domain.
import { resolveMx } from "node:dns/promises";

const CACHE_MS = 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const cache = new Map<string, { ok: boolean; at: number }>();

/** DNS answers that really mean "this domain has no mail server". */
const NO_MAIL = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

/**
 * false = the domain certainly cannot receive email (no such domain, no MX, or a "null MX").
 * true  = it can, OR the lookup failed for another reason (timeout…) — we never skip on a guess.
 */
export async function domainAcceptsEmail(
  domain: string,
  lookup: (domain: string) => Promise<{ exchange: string }[]> = resolveMx,
): Promise<boolean> {
  const key = domain.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.ok;

  let ok = true;
  try {
    const records = await Promise.race([
      lookup(key),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
    ]);
    // RFC 7505 "null MX" (exchange ".") = the domain says it accepts no email.
    ok = records.some((r) => r.exchange && r.exchange !== ".");
  } catch (err) {
    ok = !NO_MAIL.has((err as { code?: string }).code ?? "");
  }
  cache.set(key, { ok, at: Date.now() });
  return ok;
}

/** Tests only. */
export function clearMxCache() {
  cache.clear();
}
