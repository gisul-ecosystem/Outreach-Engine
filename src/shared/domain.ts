import { z } from "zod";
import { paginationSchema } from "./common";
import { DOMAIN_STATUSES, type DnsCheckResult, type DomainStatus } from "./enums";

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/** Cleans what people paste: " HTTPS://TryRacko.in/about " → "tryracko.in". */
export function cleanDomainInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "") // http://, https://
    .replace(/[/?#].*$/, "") // anything after the host
    .replace(/:\d+$/, "") // :port
    .replace(/\.$/, ""); // trailing dot
}

export function isValidDomainName(name: string): boolean {
  if (name.length > 253) return false;
  const labels = name.split(".");
  if (labels.length < 2) return false;
  return labels.every((label) => LABEL.test(label)) && TLD.test(labels[labels.length - 1]);
}

export const domainNameSchema = z
  .string({ error: "Enter a domain name" })
  .transform(cleanDomainInput)
  .pipe(
    z
      .string()
      .min(1, "Enter a domain name")
      .refine(isValidDomainName, "Enter a valid domain name, like example.com"),
  );

export const createDomainSchema = z.object({ name: domainNameSchema });
export type CreateDomainInput = z.input<typeof createDomainSchema>;

/** "go.tryracko.in" belongs to "tryracko.in": the domain itself or one of its subdomains. */
export function isHostOfDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Tracking address of a domain, e.g. "go.tryracko.in". Empty = none (links use TRACKING_BASE_URL). */
export const trackingHostSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .transform(cleanDomainInput)
    .pipe(z.string().refine(isValidDomainName, "Enter an address like go.example.com"))
    .nullable(),
);

export const updateDomainSchema = z
  .object({
    name: domainNameSchema.optional(),
    status: z.enum(DOMAIN_STATUSES).optional(),
    trackingHost: trackingHostSchema.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.status !== undefined || v.trackingHost !== undefined,
    "Nothing to update",
  );
export type UpdateDomainInput = z.input<typeof updateDomainSchema>;

export const listDomainsQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(253).optional(),
  status: z.enum(DOMAIN_STATUSES).optional(),
});

/** A domain as returned by the API. */
export type DomainDTO = {
  id: string;
  name: string;
  status: DomainStatus;
  providerConnectionId: string | null;
  dns: {
    spf: DnsCheckResult;
    dkim: DnsCheckResult;
    dmarc: DnsCheckResult;
    mx: DnsCheckResult;
    records: { spf: string[]; dkim: string[]; dmarc: string[]; mx: string[] };
    checkedAt: string | null;
  };
  /** Tracking-link host for emails from this domain, e.g. "go.tryracko.in"; null = TRACKING_BASE_URL. */
  trackingHost: string | null;
  inboxCount: number;
  createdAt: string;
  updatedAt: string;
};
