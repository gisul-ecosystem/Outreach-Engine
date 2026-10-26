import type { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import {
  Domain,
  Inbox,
  ProviderConnection,
  Settings,
  Suppression,
  type InboxDoc,
} from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { ApiError } from "@/server/lib/errors";
import {
  getProvider,
  getVerificationProvider,
  ProviderError,
  sendingMode,
  type EmailProvider,
  type SendInput,
} from "@/server/providers";
import { logEvent } from "@/server/services/event.service";
import { releaseScheduledMessages } from "@/server/services/queue.service";
import type { Paginated } from "@/shared/common";
import { DEFAULTS, type InboxStatus } from "@/shared/enums";
import {
  emailDomain,
  type DiscoverMailboxesResult,
  type ImportInboxesResult,
  type InboxDTO,
  type TestSendResult,
} from "@/shared/inbox";

type InboxRecord = InboxDoc & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date };

const DUPLICATE_KEY = 11000;

function toDTO(
  inbox: InboxRecord,
  names: { domains: Map<string, string>; providers: Map<string, string> },
): InboxDTO {
  const providerId = inbox.providerConnectionId ? String(inbox.providerConnectionId) : null;
  return {
    id: String(inbox._id),
    email: inbox.email,
    displayName: inbox.displayName ?? "",
    senderName: inbox.senderName ?? "",
    senderRole: inbox.senderRole ?? "",
    domainId: String(inbox.domainId),
    domainName: names.domains.get(String(inbox.domainId)) ?? emailDomain(inbox.email),
    providerConnectionId: providerId,
    providerName: providerId ? (names.providers.get(providerId) ?? null) : null,
    status: inbox.status as InboxStatus,
    pauseReason: inbox.pauseReason ?? null,
    dailyLimit: inbox.dailyLimit,
    minGapSeconds: inbox.minGapSeconds,
    maxGapSeconds: inbox.maxGapSeconds,
    lastSentAt: inbox.lastSentAt ? inbox.lastSentAt.toISOString() : null,
    consecutiveFailures: inbox.consecutiveFailures,
    createdAt: inbox.createdAt.toISOString(),
    updatedAt: inbox.updatedAt.toISOString(),
  };
}

/** Domain and provider names for a set of inboxes (2 queries, not one per inbox). */
async function loadNames(inboxes: InboxRecord[]) {
  const domainIds = [...new Set(inboxes.map((i) => String(i.domainId)))];
  const providerIds = [
    ...new Set(
      inboxes.flatMap((i) => (i.providerConnectionId ? [String(i.providerConnectionId)] : [])),
    ),
  ];
  const [domains, providers] = await Promise.all([
    Domain.find({ _id: { $in: domainIds } })
      .select("name")
      .lean(),
    ProviderConnection.find({ _id: { $in: providerIds } })
      .select("name")
      .lean(),
  ]);
  return {
    domains: new Map(domains.map((d) => [String(d._id), d.name])),
    providers: new Map(providers.map((p) => [String(p._id), p.name])),
  };
}

async function dto(inbox: InboxRecord) {
  return toDTO(inbox, await loadNames([inbox]));
}

async function findInboxOr404(id: string): Promise<InboxRecord> {
  const inbox = await Inbox.findOne(notDeleted({ _id: id })).lean<InboxRecord>();
  if (!inbox) throw new ApiError(404, "INBOX_NOT_FOUND", "Inbox not found");
  return inbox;
}

async function assertProviderExists(id: string) {
  if (!(await ProviderConnection.exists(notDeleted({ _id: id })))) {
    throw new ApiError(400, "INVALID_PROVIDER", "That provider connection does not exist");
  }
}

function assertGapOrder(min: number, max: number) {
  if (min > max) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "maxGapSeconds: Minimum gap must be less than or equal to the maximum gap",
    );
  }
}

const duplicateError = (email: string) =>
  new ApiError(409, "INBOX_EXISTS", `The inbox ${email} has already been added`);

export async function listInboxes(query: {
  page: number;
  limit: number;
  domainId?: string;
  status?: InboxStatus;
  search?: string;
}): Promise<Paginated<InboxDTO>> {
  await connectDB();
  const filter: Record<string, unknown> = {};
  if (query.domainId) filter.domainId = query.domainId;
  if (query.status) filter.status = query.status;
  if (query.search) {
    filter.email = { $regex: query.search.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") };
  }
  const [inboxes, total] = await Promise.all([
    Inbox.find(notDeleted(filter))
      .sort({ email: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean<InboxRecord[]>(),
    Inbox.countDocuments(notDeleted(filter)),
  ]);
  const names = await loadNames(inboxes);
  return {
    data: inboxes.map((i) => toDTO(i, names)),
    page: query.page,
    limit: query.limit,
    total,
  };
}

export async function getInbox(id: string): Promise<InboxDTO> {
  await connectDB();
  return dto(await findInboxOr404(id));
}

export async function createInbox(input: {
  domainId: string;
  providerConnectionId: string;
  email: string;
  displayName: string;
  dailyLimit?: number;
  minGapSeconds?: number;
  maxGapSeconds?: number;
}): Promise<InboxDTO> {
  await connectDB();
  const domain = await Domain.findOne(notDeleted({ _id: input.domainId })).lean();
  if (!domain) throw new ApiError(400, "INVALID_DOMAIN", "That domain does not exist");

  // Rule (BUILD_PLAN section 4): the inbox email's domain must equal its domain's name.
  if (emailDomain(input.email) !== domain.name) {
    throw new ApiError(
      400,
      "EMAIL_DOMAIN_MISMATCH",
      `email: The email must end with @${domain.name}`,
    );
  }
  await assertProviderExists(input.providerConnectionId);
  if (await Inbox.exists(notDeleted({ email: input.email }))) throw duplicateError(input.email);

  // Defaults come from the Settings document (fallback: BUILD_PLAN defaults).
  const settings = await Settings.findOne().lean();
  const dailyLimit = input.dailyLimit ?? settings?.defaultDailyLimit ?? DEFAULTS.dailyLimit;
  const minGapSeconds =
    input.minGapSeconds ?? settings?.defaultMinGapSeconds ?? DEFAULTS.minGapSeconds;
  const maxGapSeconds =
    input.maxGapSeconds ?? settings?.defaultMaxGapSeconds ?? DEFAULTS.maxGapSeconds;
  assertGapOrder(minGapSeconds, maxGapSeconds);

  let created;
  try {
    created = await Inbox.create({
      email: input.email,
      displayName: input.displayName,
      domainId: domain._id,
      providerConnectionId: input.providerConnectionId,
      dailyLimit,
      minGapSeconds,
      maxGapSeconds,
    });
  } catch (err) {
    if ((err as { code?: number }).code === DUPLICATE_KEY) throw duplicateError(input.email);
    throw err;
  }
  await logEvent("inbox.created", `Inbox ${input.email} added`, {
    inboxId: created._id,
    domainId: domain._id,
  });
  return getInbox(String(created._id));
}

export async function updateInbox(
  id: string,
  input: {
    displayName?: string;
    senderName?: string;
    senderRole?: string;
    providerConnectionId?: string;
    dailyLimit?: number;
    minGapSeconds?: number;
    maxGapSeconds?: number;
  },
): Promise<InboxDTO> {
  await connectDB();
  const inbox = await findInboxOr404(id);
  if (input.providerConnectionId) await assertProviderExists(input.providerConnectionId);
  assertGapOrder(
    input.minGapSeconds ?? inbox.minGapSeconds,
    input.maxGapSeconds ?? inbox.maxGapSeconds,
  );

  const update = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  await Inbox.updateOne({ _id: inbox._id }, { $set: update });
  return getInbox(id);
}

export async function pauseInbox(id: string, reason?: string): Promise<InboxDTO> {
  await connectDB();
  const inbox = await findInboxOr404(id);
  await Inbox.updateOne(
    { _id: inbox._id },
    { $set: { status: "paused", pauseReason: reason || "Paused by user" } },
  );
  const released = await releaseScheduledMessages({ inboxIds: [inbox._id] });
  await logEvent(
    "inbox.paused",
    `Inbox ${inbox.email} paused${released ? ` (${released} scheduled email(s) back in the queue)` : ""}`,
    { inboxId: inbox._id, domainId: inbox.domainId },
  );
  return getInbox(id);
}

export async function resumeInbox(id: string): Promise<InboxDTO> {
  await connectDB();
  const inbox = await findInboxOr404(id);
  // An inbox whose provider was deleted has nothing to send through until one is chosen.
  if (
    !inbox.providerConnectionId ||
    !(await ProviderConnection.exists(notDeleted({ _id: inbox.providerConnectionId })))
  ) {
    throw new ApiError(
      400,
      "NO_PROVIDER",
      "This inbox has no provider connection. Edit the inbox, choose a provider, then resume it.",
    );
  }
  await Inbox.updateOne(
    { _id: inbox._id },
    { $set: { status: "active", pauseReason: null, consecutiveFailures: 0 } },
  );
  await logEvent("inbox.resumed", `Inbox ${inbox.email} resumed`, {
    inboxId: inbox._id,
    domainId: inbox.domainId,
  });
  return getInbox(id);
}

/** Soft delete (history and stats are kept). */
export async function deleteInbox(id: string): Promise<{ id: string }> {
  await connectDB();
  const inbox = await findInboxOr404(id);
  await releaseScheduledMessages({ inboxIds: [inbox._id] });
  await Inbox.updateOne({ _id: inbox._id }, { $set: { deletedAt: new Date() } });
  await logEvent("inbox.deleted", `Inbox ${inbox.email} deleted`, {
    inboxId: inbox._id,
    domainId: inbox.domainId,
  });
  return { id };
}

/**
 * Sends one test email from this inbox (a short standard text, or `email` — e.g. a campaign's email).
 * DRY_RUN=true → FakeProvider (logged, not sent). Real only when DRY_RUN=false AND SENDING_ENABLED=true.
 */
export async function testSendFromInbox(
  id: string,
  to: string,
  options: {
    provider?: EmailProvider;
    email?: Pick<SendInput, "subject" | "text" | "html" | "messageId" | "listUnsubscribe">;
    /** Logged with the event (a campaign's test). */
    campaignId?: Types.ObjectId;
  } = {},
): Promise<TestSendResult> {
  await connectDB();
  const inbox = await findInboxOr404(id);

  // Safety rule: never send to a suppressed address — not even a test.
  if (await Suppression.exists({ email: to })) {
    throw new ApiError(409, "SUPPRESSED", `${to} is on the suppression list. Nothing was sent.`);
  }
  const connection = await ProviderConnection.findOne(
    notDeleted({ _id: inbox.providerConnectionId }),
  )
    .select("+clientSecretEnc")
    .lean();
  if (!connection) {
    throw new ApiError(400, "INVALID_PROVIDER", "This inbox has no provider connection");
  }

  const mode = sendingMode();
  // Test sends should not hit the FakeProvider's random 3% failure.
  const provider = options.provider ?? getProvider(connection, { fakeFailureRate: 0 });

  try {
    const result = await provider.send({
      from: inbox.email,
      fromName: inbox.displayName || undefined,
      to,
      ...(options.email ?? {
        subject: "Test email from Outreach Engine",
        text: [
          "Hello,",
          "",
          `This is a test email sent from ${inbox.email} by Outreach Engine.`,
          "If you received it, this inbox is set up correctly.",
        ].join("\n"),
      }),
    });
    const format = result.format ?? "mime";
    await logEvent(
      "inbox.test_sent",
      `Test email ${mode === "dry-run" ? "simulated (dry run)" : "sent"} from ${inbox.email} to ${to} (${format === "outlook" ? "Outlook" : "MIME"} format)`,
      { inboxId: inbox._id, domainId: inbox.domainId, campaignId: options.campaignId },
    );
    return {
      mode: mode === "dry-run" ? "dry-run" : "live",
      to,
      from: inbox.email,
      providerMessageId: result.providerMessageId ?? null,
      format,
    };
  } catch (err) {
    if (err instanceof ProviderError) {
      await logEvent("inbox.test_failed", `Test email from ${inbox.email} failed: ${err.message}`, {
        inboxId: inbox._id,
        domainId: inbox.domainId,
      });
      const hint =
        err.kind === "auth"
          ? " Check the provider connection (Verify) and the Mail.Send permission."
          : "";
      throw new ApiError(502, "SEND_FAILED", `Microsoft rejected the email: ${err.message}${hint}`);
    }
    throw err;
  }
}

// ---------- Import mailboxes from the provider ----------

/** The connection to query: the one asked for, else the one saved on the domain. */
async function connectionForDomain(
  domain: { providerConnectionId?: Types.ObjectId | null },
  requestedId?: string,
) {
  let id = requestedId ?? (domain.providerConnectionId ? String(domain.providerConnectionId) : "");
  if (!id) {
    // Domains are not tied to a connection; if there is only one, use it.
    const all = await ProviderConnection.find(notDeleted({})).select("_id").limit(2).lean();
    if (all.length === 1) id = String(all[0]._id);
  }
  if (!id) {
    throw new ApiError(
      400,
      "NO_PROVIDER",
      "Choose which Microsoft 365 connection to use (add one on the Providers page if there is none).",
    );
  }
  const connection = await ProviderConnection.findOne(notDeleted({ _id: id }))
    .select("+clientSecretEnc")
    .lean();
  if (!connection) {
    throw new ApiError(400, "INVALID_PROVIDER", "That provider connection does not exist");
  }
  return connection;
}

function asApiError(err: unknown): never {
  if (err instanceof ProviderError) {
    throw new ApiError(err.kind === "auth" ? 400 : 502, err.code, err.message);
  }
  throw err;
}

/**
 * Lists the mailboxes that exist on the domain in the provider (read-only — nothing is sent).
 * Each one is marked with whether it is already an inbox.
 */
export async function discoverMailboxes(
  domainId: string,
  options: { providerConnectionId?: string; provider?: EmailProvider } = {},
): Promise<DiscoverMailboxesResult> {
  await connectDB();
  const domain = await Domain.findOne(notDeleted({ _id: domainId })).lean();
  if (!domain) throw new ApiError(404, "DOMAIN_NOT_FOUND", "Domain not found");
  const connection = await connectionForDomain(domain, options.providerConnectionId);

  let found;
  try {
    found = await (options.provider ?? getVerificationProvider(connection)).listMailboxes(
      domain.name,
    );
  } catch (err) {
    asApiError(err);
  }

  const existing = await Inbox.find(notDeleted({ email: { $in: found.map((m) => m.email) } }))
    .select("email")
    .lean();
  const added = new Set(existing.map((i) => i.email));
  return {
    domainName: domain.name,
    providerConnectionId: String(connection._id),
    mailboxes: found.map((m) => ({ ...m, alreadyAdded: added.has(m.email) })),
  };
}

/**
 * Adds the chosen mailboxes as inboxes. Only addresses that really exist in the provider are accepted,
 * and every inbox goes through createInbox (domain rule, duplicate check, default limits).
 * Inboxes start active unless startPaused is set.
 */
export async function importInboxes(
  domainId: string,
  input: { emails: string[]; providerConnectionId?: string; startPaused?: boolean },
  options: { provider?: EmailProvider } = {},
): Promise<ImportInboxesResult> {
  const discovered = await discoverMailboxes(domainId, {
    providerConnectionId: input.providerConnectionId,
    provider: options.provider,
  });
  const byEmail = new Map(discovered.mailboxes.map((m) => [m.email, m]));

  const result: ImportInboxesResult = { imported: [], skipped: [] };
  for (const raw of new Set(input.emails.map((e) => e.trim().toLowerCase()))) {
    const mailbox = byEmail.get(raw);
    if (!mailbox) {
      result.skipped.push({ email: raw, reason: "Not found on this domain in Microsoft 365" });
      continue;
    }
    if (mailbox.alreadyAdded) {
      result.skipped.push({ email: raw, reason: "Already added" });
      continue;
    }
    try {
      const inbox = await createInbox({
        domainId,
        providerConnectionId: discovered.providerConnectionId,
        email: raw,
        displayName: mailbox.displayName,
      });
      if (input.startPaused) await pauseInbox(inbox.id, "Imported — resume when ready");
      result.imported.push(raw);
    } catch (err) {
      result.skipped.push({
        email: raw,
        reason: err instanceof Error ? err.message : "Could not be added",
      });
    }
  }
  await logEvent(
    "inbox.imported",
    `Imported ${result.imported.length} mailbox(es) on ${discovered.domainName} (${result.skipped.length} skipped)`,
    { domainId },
  );
  return result;
}
