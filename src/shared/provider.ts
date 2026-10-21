import { z } from "zod";
import { paginationSchema } from "./common";
import type { ProviderStatus, ProviderType } from "./enums";

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

export const createProviderSchema = z.object({
  name,
  // Only Microsoft 365 for now; Google Workspace is planned for v2.
  type: z
    .literal("microsoft", { error: "Only Microsoft 365 is supported for now" })
    .default("microsoft"),
  tenantId,
  clientId,
  clientSecret,
});
export type CreateProviderInput = z.input<typeof createProviderSchema>;

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
  inboxCount: number;
  createdAt: string;
  updatedAt: string;
};
