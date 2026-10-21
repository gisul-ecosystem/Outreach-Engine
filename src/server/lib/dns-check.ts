// Checks the DNS records a Microsoft 365 sending domain needs (BUILD_PLAN Phase 2).
// Never throws: a lookup that errors gives "unknown"; a record that is missing gives "fail".
import { Resolver } from "node:dns/promises";
import type { DnsCheckResult } from "@/shared/enums";

export const M365_SPF_INCLUDE = "include:spf.protection.outlook.com";
export const DKIM_SELECTORS = ["selector1", "selector2"] as const;

/** The three lookups we need. The real one is node:dns; tests pass a fake. */
export type DnsResolver = {
  resolveMx(hostname: string): Promise<{ exchange: string; priority: number }[]>;
  resolveTxt(hostname: string): Promise<string[][]>;
  resolveCname(hostname: string): Promise<string[]>;
};

export type DnsCheck = {
  spf: DnsCheckResult;
  dkim: DnsCheckResult;
  dmarc: DnsCheckResult;
  mx: DnsCheckResult;
  records: { spf: string[]; dkim: string[]; dmarc: string[]; mx: string[] };
  checkedAt: Date;
};

// These codes mean "the DNS server answered: no such record" → the record is missing (fail).
// Anything else (timeout, server failure, no network) means we could not find out (unknown).
const NOT_FOUND_CODES = new Set(["ENODATA", "ENOTFOUND", "NXDOMAIN"]);

type Lookup<T> = { found: T } | { missing: true } | { error: true };

async function lookup<T>(fn: () => Promise<T>): Promise<Lookup<T>> {
  try {
    return { found: await fn() };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return code && NOT_FOUND_CODES.has(code) ? { missing: true } : { error: true };
  }
}

/** A TXT record can be split into several strings; DNS joins them without spaces. */
const joinTxt = (records: string[][]) => records.map((chunks) => chunks.join(""));

async function checkMx(resolver: DnsResolver, domain: string) {
  const res = await lookup(() => resolver.resolveMx(domain));
  if ("error" in res) return { result: "unknown" as const, records: [] };
  if ("missing" in res || res.found.length === 0) return { result: "fail" as const, records: [] };
  // "Null MX" (RFC 7505): a single record pointing at "." means the domain accepts NO email.
  const isNull = (exchange: string) => exchange === "" || exchange === ".";
  const records = [...res.found]
    .sort((a, b) => a.priority - b.priority)
    .map((mx) =>
      isNull(mx.exchange)
        ? `${mx.priority} . (null MX: this domain accepts no email)`
        : `${mx.priority} ${mx.exchange}`,
    );
  const usable = res.found.some((mx) => !isNull(mx.exchange));
  return { result: usable ? ("pass" as const) : ("fail" as const), records };
}

async function checkSpf(resolver: DnsResolver, domain: string) {
  const res = await lookup(() => resolver.resolveTxt(domain));
  if ("error" in res) return { result: "unknown" as const, records: [] };
  if ("missing" in res) return { result: "fail" as const, records: [] };
  const spf = joinTxt(res.found).filter((txt) => /^v=spf1(\s|$)/i.test(txt.trim()));
  // Exactly one SPF record is allowed; it must include Microsoft 365's servers.
  const ok = spf.length === 1 && spf[0].toLowerCase().split(/\s+/).includes(M365_SPF_INCLUDE);
  return { result: ok ? ("pass" as const) : ("fail" as const), records: spf };
}

async function checkDmarc(resolver: DnsResolver, domain: string) {
  const res = await lookup(() => resolver.resolveTxt(`_dmarc.${domain}`));
  if ("error" in res) return { result: "unknown" as const, records: [] };
  if ("missing" in res) return { result: "fail" as const, records: [] };
  const dmarc = joinTxt(res.found).filter((txt) => /^v=DMARC1(\s*;|$)/i.test(txt.trim()));
  return { result: dmarc.length > 0 ? ("pass" as const) : ("fail" as const), records: dmarc };
}

async function checkDkim(resolver: DnsResolver, domain: string) {
  const results = await Promise.all(
    DKIM_SELECTORS.map(async (selector) => {
      const host = `${selector}._domainkey.${domain}`;
      return { selector, res: await lookup(() => resolver.resolveCname(host)) };
    }),
  );
  const records = results.flatMap(({ selector, res }) =>
    "found" in res ? res.found.map((target) => `${selector} → ${target}`) : [],
  );
  // Both selectors must exist (Microsoft 365 rotates between them).
  const allFound = results.every(({ res }) => "found" in res && res.found.length > 0);
  if (allFound) return { result: "pass" as const, records };
  const anyError = results.some(({ res }) => "error" in res);
  return { result: anyError ? ("unknown" as const) : ("fail" as const), records };
}

function defaultResolver(): DnsResolver {
  // Short timeouts so a slow DNS server can't hang the request.
  return new Resolver({ timeout: 5_000, tries: 2 });
}

/** Runs all four checks in parallel. */
export async function checkDomainDns(
  domain: string,
  resolver: DnsResolver = defaultResolver(),
): Promise<DnsCheck> {
  const [spf, dkim, dmarc, mx] = await Promise.all([
    checkSpf(resolver, domain),
    checkDkim(resolver, domain),
    checkDmarc(resolver, domain),
    checkMx(resolver, domain),
  ]);
  return {
    spf: spf.result,
    dkim: dkim.result,
    dmarc: dmarc.result,
    mx: mx.result,
    records: { spf: spf.records, dkim: dkim.records, dmarc: dmarc.records, mx: mx.records },
    checkedAt: new Date(),
  };
}
