import type { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Inbox, ProviderConnection, type ProviderConnectionDoc } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { encrypt } from "@/server/lib/crypto";
import { ApiError } from "@/server/lib/errors";
import {
  clearMicrosoftTokenCache,
  getVerificationProvider,
  type EmailProvider,
} from "@/server/providers";
import { logEvent } from "@/server/services/event.service";
import type { Paginated } from "@/shared/common";
import type { ProviderStatus, ProviderType } from "@/shared/enums";
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

export async function createProviderConnection(input: {
  name: string;
  type: "microsoft";
  tenantId: string;
  clientId: string;
  clientSecret: string;
}): Promise<ProviderDTO> {
  await connectDB();
  const created = await ProviderConnection.create({
    name: input.name,
    type: input.type,
    tenantId: input.tenantId,
    clientId: input.clientId,
    clientSecretEnc: encrypt(input.clientSecret),
    status: "unchecked",
  });
  await logEvent("provider.created", `Provider connection "${input.name}" added`);
  return dto(await findWithSecretOr404(String(created._id)));
}

export async function updateProviderConnection(
  id: string,
  input: { name?: string; tenantId?: string; clientId?: string; clientSecret?: string },
): Promise<ProviderDTO> {
  await connectDB();
  const existing = await findWithSecretOr404(id);

  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
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
  return dto(await findWithSecretOr404(id));
}

/** Soft delete. Refused while non-deleted inboxes still use this connection. */
export async function deleteProviderConnection(id: string): Promise<{ id: string }> {
  await connectDB();
  const existing = await findWithSecretOr404(id);
  const inboxes = await Inbox.countDocuments(notDeleted({ providerConnectionId: existing._id }));
  if (inboxes > 0) {
    throw new ApiError(
      409,
      "PROVIDER_IN_USE",
      `${inboxes} inbox${inboxes === 1 ? " uses" : "es use"} this connection. Delete or move ${inboxes === 1 ? "it" : "them"} first.`,
    );
  }
  await ProviderConnection.updateOne({ _id: existing._id }, { $set: { deletedAt: new Date() } });
  clearMicrosoftTokenCache(id);
  await logEvent("provider.deleted", `Provider connection "${existing.name}" deleted`);
  return { id };
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
  try {
    const provider = options.provider ?? getVerificationProvider(existing);
    result = await provider.verifyConnection();
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
