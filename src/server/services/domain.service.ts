import type { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Domain, Inbox, type DomainDoc } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { checkDomainDns, type DnsResolver } from "@/server/lib/dns-check";
import { ApiError } from "@/server/lib/errors";
import { logEvent } from "@/server/services/event.service";
import { releaseScheduledMessages } from "@/server/services/queue.service";
import type { Paginated } from "@/shared/common";
import type { DomainDTO } from "@/shared/domain";
import type { DomainStatus } from "@/shared/enums";

type DomainRecord = DomainDoc & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const DUPLICATE_KEY = 11000;

function toDTO(domain: DomainRecord, inboxCount: number): DomainDTO {
  const dns = domain.dns;
  return {
    id: String(domain._id),
    name: domain.name,
    status: domain.status as DomainStatus,
    providerConnectionId: domain.providerConnectionId ? String(domain.providerConnectionId) : null,
    dns: {
      spf: dns?.spf ?? "unknown",
      dkim: dns?.dkim ?? "unknown",
      dmarc: dns?.dmarc ?? "unknown",
      mx: dns?.mx ?? "unknown",
      records: {
        spf: dns?.records?.spf ?? [],
        dkim: dns?.records?.dkim ?? [],
        dmarc: dns?.records?.dmarc ?? [],
        mx: dns?.records?.mx ?? [],
      },
      checkedAt: dns?.checkedAt ? dns.checkedAt.toISOString() : null,
    },
    inboxCount,
    createdAt: domain.createdAt.toISOString(),
    updatedAt: domain.updatedAt.toISOString(),
  };
}

/** Number of (non-deleted) inboxes per domain id. */
async function countInboxes(domainIds: Types.ObjectId[]): Promise<Map<string, number>> {
  const rows = await Inbox.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { domainId: { $in: domainIds }, deletedAt: null } },
    { $group: { _id: "$domainId", count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

async function findDomainOr404(id: string): Promise<DomainRecord> {
  const domain = await Domain.findOne(notDeleted({ _id: id })).lean<DomainRecord>();
  if (!domain) throw new ApiError(404, "DOMAIN_NOT_FOUND", "Domain not found");
  return domain;
}

const duplicateError = (name: string) =>
  new ApiError(409, "DOMAIN_EXISTS", `The domain "${name}" has already been added`);

async function toDTOWithCount(domain: DomainRecord): Promise<DomainDTO> {
  const counts = await countInboxes([domain._id]);
  return toDTO(domain, counts.get(String(domain._id)) ?? 0);
}

async function runDnsCheck(domain: DomainRecord, resolver?: DnsResolver): Promise<DomainRecord> {
  const dns = await checkDomainDns(domain.name, resolver);
  const updated = await Domain.findByIdAndUpdate(
    domain._id,
    { $set: { dns } },
    { new: true },
  ).lean<DomainRecord>();
  return updated ?? domain;
}

export async function listDomains(query: {
  page: number;
  limit: number;
  search?: string;
  status?: DomainStatus;
}): Promise<Paginated<DomainDTO>> {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.search) filter.name = { $regex: escapeRegex(query.search.toLowerCase()) };

  const [domains, total] = await Promise.all([
    Domain.find(notDeleted(filter))
      .sort({ name: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<DomainRecord[]>(),
    Domain.countDocuments(notDeleted(filter)),
  ]);
  const counts = await countInboxes(domains.map((d) => d._id));
  return {
    data: domains.map((d) => toDTO(d, counts.get(String(d._id)) ?? 0)),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function getDomain(id: string): Promise<DomainDTO> {
  await connectDB();
  return toDTOWithCount(await findDomainOr404(id));
}

/** Adds a domain and immediately checks its DNS. `name` must already be validated/cleaned (zod). */
export async function createDomain(
  input: { name: string },
  options: { resolver?: DnsResolver } = {},
): Promise<DomainDTO> {
  await connectDB();
  if (await Domain.exists(notDeleted({ name: input.name }))) throw duplicateError(input.name);

  let created: DomainRecord;
  try {
    created = (await Domain.create({ name: input.name })).toObject() as DomainRecord;
  } catch (err) {
    if ((err as { code?: number }).code === DUPLICATE_KEY) throw duplicateError(input.name);
    throw err;
  }
  await logEvent("domain.created", `Domain ${input.name} added`, { domainId: created._id });

  const checked = await runDnsCheck(created, options.resolver);
  return toDTO(checked, 0);
}

export async function updateDomain(
  id: string,
  input: { name?: string; status?: DomainStatus },
  options: { resolver?: DnsResolver } = {},
): Promise<DomainDTO> {
  await connectDB();
  const domain = await findDomainOr404(id);
  const inboxIds = await Inbox.find(notDeleted({ domainId: domain._id })).distinct("_id");

  const update: Record<string, unknown> = {};
  const renamed = input.name !== undefined && input.name !== domain.name;
  if (renamed) {
    // Inbox emails must match their domain's name, so a domain with inboxes can't be renamed.
    if (inboxIds.length > 0) {
      throw new ApiError(
        409,
        "DOMAIN_HAS_INBOXES",
        "This domain has inboxes. Remove them before renaming the domain.",
      );
    }
    if (await Domain.exists(notDeleted({ name: input.name, _id: { $ne: domain._id } }))) {
      throw duplicateError(input.name!);
    }
    update.name = input.name;
  }
  if (input.status !== undefined && input.status !== domain.status) update.status = input.status;

  if (Object.keys(update).length === 0) return toDTOWithCount(domain);

  let updated: DomainRecord | null;
  try {
    updated = await Domain.findByIdAndUpdate(
      domain._id,
      { $set: update },
      { new: true },
    ).lean<DomainRecord>();
  } catch (err) {
    if ((err as { code?: number }).code === DUPLICATE_KEY) throw duplicateError(input.name!);
    throw err;
  }
  if (!updated) throw new ApiError(404, "DOMAIN_NOT_FOUND", "Domain not found");

  if (update.status === "paused") {
    await releaseScheduledMessages({ inboxIds });
    await logEvent("domain.paused", `Domain ${updated.name} paused`, { domainId: updated._id });
  } else if (update.status === "active") {
    await logEvent("domain.activated", `Domain ${updated.name} activated`, {
      domainId: updated._id,
    });
  }
  if (renamed) {
    await logEvent("domain.renamed", `Domain ${domain.name} renamed to ${updated.name}`, {
      domainId: updated._id,
    });
    updated = await runDnsCheck(updated, options.resolver); // old DNS results no longer apply
  }
  return toDTOWithCount(updated);
}

/** Soft-deletes the domain AND its inboxes (history and stats are kept). */
export async function deleteDomain(id: string): Promise<{ id: string; deletedInboxes: number }> {
  await connectDB();
  const domain = await findDomainOr404(id);
  const now = new Date();

  const inboxIds = await Inbox.find(notDeleted({ domainId: domain._id })).distinct("_id");
  await releaseScheduledMessages({ inboxIds });
  const inboxes = await Inbox.updateMany(notDeleted({ domainId: domain._id }), {
    $set: { deletedAt: now },
  });
  await Domain.updateOne({ _id: domain._id }, { $set: { deletedAt: now } });

  await logEvent(
    "domain.deleted",
    `Domain ${domain.name} deleted (with ${inboxes.modifiedCount} inbox(es))`,
    { domainId: domain._id },
  );
  return { id: String(domain._id), deletedInboxes: inboxes.modifiedCount };
}

export async function recheckDomainDns(
  id: string,
  options: { resolver?: DnsResolver } = {},
): Promise<DomainDTO> {
  await connectDB();
  const domain = await findDomainOr404(id);
  return toDTOWithCount(await runDnsCheck(domain, options.resolver));
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
