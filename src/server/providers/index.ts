import type { Types } from "mongoose";
import { getEnv } from "@/server/config/env";
import { decrypt } from "@/server/lib/crypto";
import { ApiError } from "@/server/lib/errors";
import { FakeProvider } from "./fake.provider";
import { MicrosoftGraphProvider } from "./microsoft-graph.provider";
import type { EmailProvider } from "./types";

export * from "./types";
export { FakeProvider } from "./fake.provider";
export { clearMicrosoftTokenCache, MicrosoftGraphProvider } from "./microsoft-graph.provider";

/** What a connection document must contain (clientSecretEnc must be selected with "+clientSecretEnc"). */
export type ConnectionForProvider = {
  _id: Types.ObjectId | string;
  type: string;
  tenantId?: string | null;
  clientId?: string | null;
  clientSecretEnc?: string | null;
  updatedAt?: Date;
};

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

/** The real Microsoft provider for a connection (decrypts the secret in memory only). */
function microsoftProvider(connection: ConnectionForProvider): MicrosoftGraphProvider {
  if (connection.type !== "microsoft") {
    throw new ApiError(400, "PROVIDER_NOT_SUPPORTED", "Only Microsoft 365 is supported for now");
  }
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
  );
}

/**
 * The provider to SEND with. FakeProvider whenever DRY_RUN=true (BUILD_PLAN section 7).
 * Throws SENDING_DISABLED when real sending is switched off.
 */
export function getProvider(
  connection: ConnectionForProvider,
  options: { fakeFailureRate?: number } = {},
): EmailProvider {
  const mode = sendingMode();
  if (mode === "dry-run") return new FakeProvider({ failureRate: options.fakeFailureRate });
  if (mode === "disabled") {
    throw new ApiError(
      409,
      "SENDING_DISABLED",
      "Sending is switched off (SENDING_ENABLED=false in .env.local). Nothing was sent.",
    );
  }
  return microsoftProvider(connection);
}

/**
 * The provider used by the Verify button. Always the real one: verifying only asks Microsoft for an
 * access token and never sends email, so it is safe in dry-run mode too.
 */
export function getVerificationProvider(connection: ConnectionForProvider): EmailProvider {
  return microsoftProvider(connection);
}
