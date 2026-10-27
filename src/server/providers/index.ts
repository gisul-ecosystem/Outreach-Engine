import type { Types } from "mongoose";
import { getEnv } from "@/server/config/env";
import { decrypt } from "@/server/lib/crypto";
import { ApiError } from "@/server/lib/errors";
import {
  DEFAULT_SEND_FORMAT,
  DEFAULT_ZEPTO_REGION,
  SEND_FORMATS,
  ZEPTO_REGIONS,
  type SendFormat,
  type ZeptoRegion,
} from "@/shared/enums";
import { FakeProvider } from "./fake.provider";
import { MicrosoftGraphProvider } from "./microsoft-graph.provider";
import type { EmailProvider } from "./types";
import { ZeptoMailProvider } from "./zeptomail.provider";

export * from "./types";
export { FakeProvider } from "./fake.provider";
export {
  clearMicrosoftTokenCache,
  MicrosoftGraphProvider,
  permissionsFromToken,
} from "./microsoft-graph.provider";
export { ZeptoMailProvider, zeptoApiUrl } from "./zeptomail.provider";

/** What a connection document must contain (clientSecretEnc must be selected with "+clientSecretEnc"). */
export type ConnectionForProvider = {
  _id: Types.ObjectId | string;
  type: string;
  tenantId?: string | null;
  clientId?: string | null;
  clientSecretEnc?: string | null;
  sendFormat?: string | null;
  region?: string | null;
  updatedAt?: Date;
};

/**
 * The connection's send format; connections saved before the setting existed use the default (outlook).
 * ZeptoMail always gets the engine-built email (subject + text + HTML), so it counts as "mime".
 */
export function sendFormatOf(
  connection: { type?: string | null; sendFormat?: string | null } | null | undefined,
): SendFormat {
  if (connection?.type === "zeptomail") return "mime";
  const value = connection?.sendFormat;
  return SEND_FORMATS.includes(value as SendFormat) ? (value as SendFormat) : DEFAULT_SEND_FORMAT;
}

export type SendingMode = "dry-run" | "live" | "disabled";

/**
 * Safety rule (CLAUDE.md): real email only when DRY_RUN=false AND SENDING_ENABLED=true.
 * - dry-run:  DRY_RUN=true → FakeProvider, nothing is sent
 * - disabled: DRY_RUN=false but SENDING_ENABLED=false → nothing may be sent
 * - live:     real sending
 */
export function sendingMode(): SendingMode {
  const env = getEnv();
  if (env.DRY_RUN) return "dry-run";
  return env.SENDING_ENABLED ? "live" : "disabled";
}

/** The real provider for a connection, by its type (decrypts the secret in memory only). */
function realProvider(connection: ConnectionForProvider): EmailProvider {
  if (connection.type === "microsoft") return microsoftProvider(connection);
  if (connection.type === "zeptomail") return zeptoProvider(connection);
  throw new ApiError(
    400,
    "PROVIDER_NOT_SUPPORTED",
    "Only Microsoft 365 and ZeptoMail are supported for now",
  );
}

function zeptoProvider(connection: ConnectionForProvider): ZeptoMailProvider {
  if (!connection.clientSecretEnc) {
    throw new ApiError(
      400,
      "PROVIDER_INCOMPLETE",
      "This connection is missing its Send Mail token",
    );
  }
  const region = ZEPTO_REGIONS.includes(connection.region as ZeptoRegion)
    ? (connection.region as ZeptoRegion)
    : DEFAULT_ZEPTO_REGION;
  return new ZeptoMailProvider({ token: decrypt(connection.clientSecretEnc), region });
}

/** The real Microsoft provider for a connection (decrypts the secret in memory only). */
function microsoftProvider(connection: ConnectionForProvider): MicrosoftGraphProvider {
  if (!connection.tenantId || !connection.clientId || !connection.clientSecretEnc) {
    throw new ApiError(400, "PROVIDER_INCOMPLETE", "This connection is missing its credentials");
  }
  const cacheKey = `${String(connection._id)}:${connection.updatedAt?.getTime() ?? 0}`;
  return new MicrosoftGraphProvider(
    {
      tenantId: connection.tenantId,
      clientId: connection.clientId,
      clientSecret: decrypt(connection.clientSecretEnc),
    },
    cacheKey,
    { sendFormat: sendFormatOf(connection) },
  );
}

/**
 * The provider to SEND with. FakeProvider whenever DRY_RUN=true (BUILD_PLAN section 7).
 * Throws SENDING_DISABLED when real sending is switched off.
 * Both use the connection's send format (outlook / mime).
 */
export function getProvider(
  connection: ConnectionForProvider,
  options: { fakeFailureRate?: number } = {},
): EmailProvider {
  const mode = sendingMode();
  if (mode === "dry-run") {
    return new FakeProvider({
      failureRate: options.fakeFailureRate,
      sendFormat: sendFormatOf(connection),
    });
  }
  if (mode === "disabled") {
    throw new ApiError(
      409,
      "SENDING_DISABLED",
      "Sending is switched off (SENDING_ENABLED=false in .env.local). Nothing was sent.",
    );
  }
  return realProvider(connection);
}

/**
 * The provider used by the Verify button (and to read mailboxes). Always the real one: verifying never
 * sends email (Microsoft: it only asks for an access token; ZeptoMail: an empty request that is
 * refused), so it is safe in dry-run mode too.
 */
export function getVerificationProvider(connection: ConnectionForProvider): EmailProvider {
  return realProvider(connection);
}
