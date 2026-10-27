import { z } from "zod";
import { paginationSchema } from "./common";
import {
  DEFAULT_SEND_FORMAT,
  DEFAULT_ZEPTO_REGION,
  SEND_FORMATS,
  ZEPTO_REGIONS,
  type ProviderStatus,
  type ProviderType,
  type SendFormat,
  type ZeptoRegion,
} from "./enums";

// Microsoft Tenant ID: a GUID or a tenant domain like contoso.onmicrosoft.com
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

const name = z.string().trim().min(1, "Enter a name").max(100, "Name is too long");
const tenantId = z
  .string()
  .trim()
  .refine((v) => GUID.test(v) || TENANT_DOMAIN.test(v), "Enter the Directory (tenant) ID — a GUID");
const clientId = z
  .string()
  .trim()
  .regex(
    GUID,
    "Enter the Application (client) ID — a GUID like 00000000-0000-0000-0000-000000000000",
  );
const clientSecret = z
  .string()
  .trim()
  .min(8, "Enter the client secret VALUE (not the secret ID)")
  .max(500, "Client secret is too long");
const sendFormat = z.enum(SEND_FORMATS, { error: "Choose Outlook or MIME" });

/** Mail.Read (or Mail.ReadWrite, which includes it) lets the engine read bounces, replies and Sent Items. */
export function hasMailRead(permissions: string[]): boolean {
  return permissions.some((p) => p === "Mail.Read" || p === "Mail.ReadWrite");
}

/** Shown next to the "Sending format" choice. */
export const SEND_FORMAT_LABELS: Record<SendFormat, { label: string; description: string }> = {
  outlook: {
    label: "Outlook standard (recommended)",
    description:
      "Microsoft builds each email exactly like one typed in Outlook. A follow-up is a real reply in the same conversation.",
  },
  mime: {
    label: "Raw MIME (older way)",
    description:
      "The engine builds the whole email itself, with its own Message-ID and an Unsubscribe header.",
  },
};

/** Shown wherever a connection's kind is named. */
export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  microsoft: "Microsoft 365",
  google: "Google Workspace",
  zeptomail: "ZeptoMail",
};

export const ZEPTO_REGION_LABELS: Record<ZeptoRegion, string> = {
  in: "India (zeptomail.in)",
  com: "United States (zeptomail.com)",
  eu: "Europe (zeptomail.eu)",
  "com.au": "Australia (zeptomail.com.au)",
};

const zeptoRegion = z.enum(ZEPTO_REGIONS, { error: "Choose the region of your ZeptoMail account" });
/** The Mail Agent's Send Mail token. ZeptoMail shows it with a "Zoho-enczapikey " prefix; that is dropped. */
const zeptoToken = z
  .string()
  .trim()
  .transform((v) => v.replace(/^Zoho-enczapikey\s+/i, "").trim())
  .pipe(
    z
      .string()
      .min(20, "Paste the Send Mail token of your ZeptoMail Mail Agent")
      .max(2000, "Token is too long")
      .regex(/^\S+$/, "The token cannot contain spaces"),
  );

export const createProviderSchema = z.object({
  name,
  // Microsoft 365 here; ZeptoMail has its own schema below. Google Workspace is planned for v2.
  type: z.literal("microsoft", { error: "Choose Microsoft 365 or ZeptoMail" }).default("microsoft"),
  tenantId,
  clientId,
  clientSecret,
  sendFormat: sendFormat.default(DEFAULT_SEND_FORMAT),
});
export type CreateProviderInput = z.input<typeof createProviderSchema>;

/** `POST /api/providers` with type "zeptomail". */
export const createZeptoProviderSchema = z.object({
  name,
  type: z.literal("zeptomail"),
  region: zeptoRegion.default(DEFAULT_ZEPTO_REGION),
  apiToken: zeptoToken,
});
export type CreateZeptoProviderInput = z.input<typeof createZeptoProviderSchema>;

/** Edit form for a ZeptoMail connection: the token may be left empty (= keep the saved one). */
export const editZeptoProviderFormSchema = createZeptoProviderSchema.extend({
  apiToken: z.string().trim(),
});

/** Edit form: same fields, but the secret may be left empty (= keep the saved one). */
export const editProviderFormSchema = createProviderSchema.extend({
  clientSecret: z
    .string()
    .trim()
    .refine((v) => v === "" || v.length >= 8, "Enter the client secret VALUE (not the secret ID)")
    .refine((v) => v.length <= 500, "Client secret is too long"),
});

/** Leave clientSecret empty to keep the saved one. */
export const updateProviderSchema = z
  .object({
    name: name.optional(),
    tenantId: tenantId.optional(),
    clientId: clientId.optional(),
    clientSecret: z
      .string()
      .trim()
      .transform((v) => (v === "" ? undefined : v))
      .pipe(clientSecret.optional())
      .optional(),
    sendFormat: sendFormat.optional(),
    // ZeptoMail connections only. Leave apiToken empty to keep the saved one.
    region: zeptoRegion.optional(),
    apiToken: z
      .string()
      .trim()
      .transform((v) => (v === "" ? undefined : v))
      .pipe(zeptoToken.optional())
      .optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), "Nothing to update");
export type UpdateProviderInput = z.input<typeof updateProviderSchema>;

export const listProvidersQuerySchema = paginationSchema;

/** A provider connection as returned by the API — the secret is NEVER included. */
export type ProviderDTO = {
  id: string;
  name: string;
  type: ProviderType;
  tenantId: string;
  clientId: string;
  secretSet: boolean;
  status: ProviderStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** How emails are handed to Microsoft. */
  sendFormat: SendFormat;
  /** Application permissions Microsoft granted (found at the last Verify); null = not checked yet. */
  grantedPermissions: string[] | null;
  /** ZeptoMail: the account's region; null for Microsoft. */
  region: ZeptoRegion | null;
  inboxCount: number;
  createdAt: string;
  updatedAt: string;
};
