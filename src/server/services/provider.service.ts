import type { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Domain, Inbox, ProviderConnection, type ProviderConnectionDoc } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { encrypt } from "@/server/lib/crypto";
import { ApiError } from "@/server/lib/errors";
import {
  clearMicrosoftTokenCache,
  getVerificationProvider,
  sendFormatOf,
  type EmailProvider,
} from "@/server/providers";
import { logEvent } from "@/server/services/event.service";
import { releaseScheduledMessages } from "@/server/services/queue.service";
import type { Paginated } from "@/shared/common";
import {
  DEFAULT_ZEPTO_REGION,
  type ProviderStatus,
  type ProviderType,
  type SendFormat,
  type ZeptoRegion,
} from "@/shared/enums";
import type { ProviderDTO } from "@/shared/provider";

type ProviderRecord = ProviderConnectionDoc & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

function toDTO(p: ProviderRecord, inboxCount: number, secretSet: boolean): ProviderDTO {
  return {
    id: String(p._id),
    name: p.name,
    type: p.type as ProviderType,
    tenantId: p.tenantId ?? "",
    clientId: p.clientId ?? "",
    secretSet,
    status: p.status as ProviderStatus,
    lastCheckedAt: p.lastCheckedAt ? p.lastCheckedAt.toISOString() : null,
    lastError: p.lastError ?? null,
    sendFormat: sendFormatOf(p),
    grantedPermissions: p.grantedPermissions ? [...p.grantedPermissions] : null,
    region:
      p.type === "zeptomail" ? ((p.region as ZeptoRegion | null) ?? DEFAULT_ZEPTO_REGION) : null,
    inboxCount,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function countInboxes(ids: Types.ObjectId[]) {
  const rows = await Inbox.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { providerConnectionId: { $in: ids }, deletedAt: null } },
    { $group: { _id: "$providerConnectionId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

/** Loads a connection WITH its encrypted secret (server-side use only). */
async function findWithSecretOr404(id: string) {
  const p = await ProviderConnection.findOne(notDeleted({ _id: id }))
    .select("+clientSecretEnc")
    .lean<ProviderRecord>();
  if (!p) throw new ApiError(404, "PROVIDER_NOT_FOUND", "Provider connection not found");
  return p;
}

async function dto(p: ProviderRecord): Promise<ProviderDTO> {
  const counts = await countInboxes([p._id]);
  return toDTO(p, counts.get(String(p._id)) ?? 0, Boolean(p.clientSecretEnc));
}

export async function listProviders(query: {
  page: number;
  limit: number;
}): Promise<Paginated<ProviderDTO>> {
  await connectDB();
  const [items, total] = await Promise.all([
    ProviderConnection.find(notDeleted())
      .select("+clientSecretEnc") // only to report secretSet; never returned
      .sort({ createdAt: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<ProviderRecord[]>(),
    ProviderConnection.countDocuments(notDeleted()),
  ]);
  const counts = await countInboxes(items.map((p) => p._id));
  return {
    data: items.map((p) => toDTO(p, counts.get(String(p._id)) ?? 0, Boolean(p.clientSecretEnc))),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function getProviderConnection(id: string): Promise<ProviderDTO> {
  await connectDB();
  return dto(await findWithSecretOr404(id));
}

export async function createProviderConnection(
  input:
    | {
        name: string;
        type: "microsoft";
        tenantId: string;
        clientId: string;
        clientSecret: string;
        sendFormat?: SendFormat;
      }
    | { name: string; type: "zeptomail"; region: ZeptoRegion; apiToken: string },
): Promise<ProviderDTO> {
  await connectDB();
  if (input.type === "zeptomail") {
    // The Send Mail token is kept in the same encrypted, never-returned field as Microsoft's secret.
    const created = await ProviderConnection.create({
      name: input.name,
      type: "zeptomail",
      region: input.region,
      clientSecretEnc: encrypt(input.apiToken),
      status: "unchecked",
    });
    await logEvent("provider.created", `ZeptoMail connection "${input.name}" added`);
    return dto(await findWithSecretOr404(String(created._id)));
  }
  const created = await ProviderConnection.create({
    name: input.name,
    type: input.type,
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientSecretEnc: encrypt(input.clientSecret),
    status: "unchecked",
    ...(input.sendFormat ? { sendFormat: input.sendFormat } : {}),
  });
  await logEvent("provider.created", `Provider connection "${input.name}" added`);
  return dto(await findWithSecretOr404(String(created._id)));
}

export async function updateProviderConnection(
  id: string,
  input: {
    name?: string;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    sendFormat?: SendFormat;
    region?: ZeptoRegion;
    apiToken?: string;
  },
): Promise<ProviderDTO> {
  await connectDB();
  const existing = await findWithSecretOr404(id);
  if (existing.type === "zeptomail") return updateZeptoConnection(existing, input);
  if (input.region !== undefined || input.apiToken !== undefined) {
    throw new ApiError(
      400,
      "INVALID_FIELDS",
      "Region and Send Mail token are only for ZeptoMail connections",
    );
  }

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.sendFormat !== undefined) update.sendFormat = input.sendFormat;
  if (input.tenantId !== undefined) update.tenantId = input.tenantId;
  if (input.clientId !== undefined) update.clientId = input.clientId;
  if (input.clientSecret !== undefined) update.clientSecretEnc = encrypt(input.clientSecret);

  const credentialsChanged =
    (input.tenantId !== undefined && input.tenantId !== existing.tenantId) ||
    (input.clientId !== undefined && input.clientId !== existing.clientId) ||
    input.clientSecret !== undefined;
  if (credentialsChanged) {
    // New credentials must be verified again before the worker uses them.
    Object.assign(update, { status: "unchecked", lastError: null, lastCheckedAt: null });
    clearMicrosoftTokenCache(id);
  }

  await ProviderConnection.updateOne({ _id: existing._id }, { $set: update });
  if (credentialsChanged) {
    await logEvent(
      "provider.updated",
      `Provider connection "${existing.name}" credentials changed`,
    );
  }
  if (input.sendFormat !== undefined && input.sendFormat !== sendFormatOf(existing)) {
    await logEvent(
      "provider.updated",
      `Provider connection "${existing.name}" now sends in ${input.sendFormat === "outlook" ? "Outlook" : "MIME"} format`,
    );
  }
  return dto(await findWithSecretOr404(id));
}

/** Name, region and token (empty token = keep the saved one). A new token or region must be verified again. */
async function updateZeptoConnection(
  existing: ProviderRecord,
  input: {
    name?: string;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    sendFormat?: SendFormat;
    region?: ZeptoRegion;
    apiToken?: string;
  },
): Promise<ProviderDTO> {
  if (
    input.tenantId !== undefined ||
    input.clientId !== undefined ||
    input.clientSecret !== undefined ||
    input.sendFormat !== undefined
  ) {
    throw new ApiError(
      400,
      "INVALID_FIELDS",
      "Tenant ID, Client ID, client secret and sending format are only for Microsoft 365 connections",
    );
  }
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.region !== undefined) update.region = input.region;
  if (input.apiToken !== undefined) update.clientSecretEnc = encrypt(input.apiToken);

  const credentialsChanged =
    (input.region !== undefined && input.region !== existing.region) ||
    input.apiToken !== undefined;
  if (credentialsChanged) {
    Object.assign(update, { status: "unchecked", lastError: null, lastCheckedAt: null });
  }
  await ProviderConnection.updateOne({ _id: existing._id }, { $set: update });
  if (credentialsChanged) {
    await logEvent(
      "provider.updated",
      `ZeptoMail connection "${existing.name}" token or region changed`,
    );
  }
  return dto(await findWithSecretOr404(String(existing._id)));
}

export const PROVIDER_DELETED_REASON = "Provider deleted — edit the inbox to choose a new provider";

/**
 * Soft delete. Inboxes that used this connection are kept but paused and unlinked
 * (providerConnectionId = null); their scheduled emails go back in the queue.
 * The user picks a new provider for each inbox (Edit) and resumes it.
 */
export async function deleteProviderConnection(
  id: string,
): Promise<{ id: string; pausedInboxes: number }> {
  await connectDB();
  const existing = await findWithSecretOr404(id);

  const inboxIds = (
    await Inbox.find(notDeleted({ providerConnectionId: existing._id }))
      .select("_id")
      .lean()
  ).map((i) => i._id);
  // Pause first so the planner stops picking these inboxes, then release what was already planned.
  if (inboxIds.length > 0) {
    await Inbox.updateMany(
      { _id: { $in: inboxIds } },
      {
        $set: {
          status: "paused",
          pauseReason: PROVIDER_DELETED_REASON,
          providerConnectionId: null,
        },
      },
    );
  }
  const released = await releaseScheduledMessages({ inboxIds });
  // Inboxes that only READ through it go back to reading with their sending connection.
  await Inbox.updateMany(
    { readingConnectionId: existing._id },
    {
      $set: {
        readingConnectionId: null,
        mailboxCheckedAt: null,
        repliesCheckedAt: null,
        incomingCheckedAt: null,
      },
    },
  );
  await Domain.updateMany(
    { providerConnectionId: existing._id },
    { $set: { providerConnectionId: null } },
  );

  await ProviderConnection.updateOne({ _id: existing._id }, { $set: { deletedAt: new Date() } });
  clearMicrosoftTokenCache(id);
  const details = inboxIds.length
    ? ` — ${inboxIds.length} inbox(es) paused and need a new provider${released ? `, ${released} scheduled email(s) back in the queue` : ""}`
    : "";
  await logEvent("provider.deleted", `Provider connection "${existing.name}" deleted${details}`);
  return { id, pausedInboxes: inboxIds.length };
}

/**
 * Verify button: asks Microsoft for an access token with the saved credentials.
 * Sets status connected / error and stores a readable error (never the secret).
 */
export async function verifyProviderConnection(
  id: string,
  options: { provider?: EmailProvider } = {},
): Promise<ProviderDTO> {
  await connectDB();
  const existing = await findWithSecretOr404(id);

  let result: { ok: boolean; error?: string };
  let permissions: string[] | null = null;
  try {
    const provider = options.provider ?? getVerificationProvider(existing);
    result = await provider.verifyConnection();
    // Which permissions admin consent was given for (e.g. is Mail.Read there for bounces?).
    if (result.ok) permissions = (await provider.grantedPermissions?.()) ?? null;
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  await ProviderConnection.updateOne(
    { _id: existing._id },
    {
      $set: {
        status: result.ok ? "connected" : "error",
        lastCheckedAt: new Date(),
        lastError: result.ok ? null : (result.error ?? "Verification failed"),
        ...(result.ok ? { grantedPermissions: permissions } : {}),
      },
    },
  );
  await logEvent(
    result.ok ? "provider.connected" : "provider.error",
    result.ok
      ? `Provider connection "${existing.name}" verified`
      : `Provider connection "${existing.name}" failed verification: ${result.error}`,
  );
  return dto(await findWithSecretOr404(id));
}
