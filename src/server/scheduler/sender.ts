// Sender tick (every 10 s): sends the emails the planner scheduled (BUILD_PLAN section 6).
// Every message state change below is ONE atomic findOneAndUpdate that names the status we expect.
import type { Types } from "mongoose";
import {
  Campaign,
  Contact,
  Domain,
  Inbox,
  Message,
  ProviderConnection,
  Suppression,
  type MessageDoc,
} from "@/server/db/models";
import { createLogger } from "@/server/lib/logger";
import { renderEmail } from "@/server/lib/template";
import { getProvider, sendingMode, ProviderError } from "@/server/providers";
import { logEvent } from "@/server/services/event.service";
import { releaseScheduledMessages } from "@/server/services/queue.service";
import { getTimezone } from "@/server/services/settings.service";
import { syncContactsWithSuppressions } from "@/server/services/suppression.service";
import { ApiError } from "@/server/lib/errors";
import { canInboxSendNow, classifyRetry, contactBlockReason } from "./rules";

const log = createLogger("sender");

/** A claimed message is locked for this long; after that the recovery tick treats it as stuck. */
export const SEND_LOCK_MS = 2 * 60 * 1000;
/** An inbox that fails this many times in a row is paused automatically. */
export const AUTO_PAUSE_AFTER_FAILURES = 5;
/** Safety cap on how many messages one tick may claim. */
const MAX_CLAIMS_PER_TICK = 50;

type MessageRecord = MessageDoc & { _id: Types.ObjectId };

/** Inboxes with a send in progress in THIS process: a second line of defence for "one at a time per inbox". */
const busyInboxes = new Set<string>();

export type SenderResult = {
  claimed: number;
  sent: number;
  failed: number;
  retried: number;
  released: number;
  skipped: number;
};

export async function senderTick(now = new Date()): Promise<SenderResult> {
  const result: SenderResult = {
    claimed: 0,
    sent: 0,
    failed: 0,
    retried: 0,
    released: 0,
    skipped: 0,
  };
  // Kill switch.
  if (sendingMode() === "disabled") return result;

  const claimed: MessageRecord[] = [];
  while (claimed.length < MAX_CLAIMS_PER_TICK) {
    const message = await Message.findOneAndUpdate(
      { status: "scheduled", scheduledAt: { $lte: now } },
      {
        $set: { status: "sending", lockedUntil: new Date(now.getTime() + SEND_LOCK_MS) },
        $inc: { attempts: 1 },
      },
      { sort: { scheduledAt: 1 }, returnDocument: "after" },
    ).lean<MessageRecord>();
    if (!message) break;
    claimed.push(message);
  }
  result.claimed = claimed.length;
  if (claimed.length === 0) return result;

  const tz = await getTimezone();
  // Different inboxes in parallel; the database allows only one in-flight message per inbox,
  // so within one inbox this is always one at a time.
  await Promise.all(
    claimed.map(async (message) => {
      const key = String(message.inboxId);
      if (busyInboxes.has(key)) {
        // Cannot happen with the unique index; if it ever does, hand the message back untouched.
        await giveBack(message, "scheduled");
        result.released++;
        return;
      }
      busyInboxes.add(key);
      try {
        const outcome = await processMessage(message, now, tz);
        result[outcome]++;
      } catch (err) {
        // Anything unexpected: leave the message `sending`. The recovery tick will mark it
        // failed (UNKNOWN_STATE) once its lock expires — it is NEVER sent again automatically.
        log.error(
          `message ${String(message._id)} crashed`,
          err instanceof Error ? err.message : err,
        );
      } finally {
        busyInboxes.delete(key);
      }
    }),
  );
  return result;
}

type Outcome = "sent" | "failed" | "retried" | "released" | "skipped";

/** sending → pending (or scheduled): nothing was tried, so the attempt we counted is taken back. */
async function giveBack(message: MessageRecord, to: "pending" | "scheduled"): Promise<boolean> {
  const update =
    to === "pending"
      ? {
          $set: { status: "pending", inboxId: null, scheduledAt: null, lockedUntil: null },
          $inc: { attempts: -1 },
        }
      : { $set: { status: "scheduled", lockedUntil: null }, $inc: { attempts: -1 } };
  return (await Message.findOneAndUpdate({ _id: message._id, status: "sending" }, update)) !== null;
}

async function processMessage(message: MessageRecord, now: Date, tz: string): Promise<Outcome> {
  const mode = sendingMode();
  const [inbox, campaign, contact, suppressed] = await Promise.all([
    Inbox.findById(message.inboxId).lean(),
    Campaign.findById(message.campaignId).lean(),
    Contact.findById(message.contactId).lean(),
    Suppression.exists({ email: message.toEmail }),
  ]);

  // ---- Re-check everything right before sending (CLAUDE.md safety rules) ----
  const blocked = contactBlockReason(contact, suppressed !== null);
  if (blocked) {
    await Message.findOneAndUpdate(
      { _id: message._id, status: "sending" },
      { $set: { status: "skipped", lockedUntil: null, error: blocked } },
    );
    return "skipped";
  }

  const window = {
    startMinute: campaign?.sendWindow?.startMinute ?? 0,
    endMinute: campaign?.sendWindow?.endMinute ?? 0,
    days: [...(campaign?.sendWindow?.days ?? [])],
  };
  const [domain, connection] = await Promise.all([
    inbox ? Domain.findById(inbox.domainId).lean() : null,
    // The encrypted secret is only loaded when a real send is about to happen.
    inbox?.providerConnectionId
      ? ProviderConnection.findById(inbox.providerConnectionId)
          .select(mode === "live" ? "+clientSecretEnc" : "-clientSecretEnc")
          .lean()
      : null,
  ]);
  const usable = canInboxSendNow(inbox, domain, connection, 0, false, now, window, tz, {
    requireConnected: mode === "live",
  });
  const campaignRunning = !!campaign && campaign.status === "running" && !campaign.deletedAt;
  if (!usable.ok || !campaignRunning || !inbox) {
    // Campaign paused, inbox/domain/connection unavailable, or the window closed while we waited:
    // do not send. The planner will plan it again when conditions allow.
    await giveBack(message, "pending");
    return "released";
  }

  // ---- Render + send ----
  const email = renderEmail(campaign, contact ?? { email: message.toEmail });
  let provider;
  try {
    provider = getProvider(
      connection ? { ...connection, _id: connection._id } : { _id: "dry-run", type: "microsoft" },
    );
  } catch (err) {
    if (err instanceof ApiError && err.code === "SENDING_DISABLED") {
      await giveBack(message, "pending");
      return "released";
    }
    // Credentials cannot be read (e.g. wrong ENCRYPTION_KEY): nothing was sent, a human must fix it.
    return fail(message, inbox, {
      code: "CONFIG_ERROR",
      message: err instanceof Error ? err.message : "Could not set up the email provider",
    });
  }

  let providerMessageId: string | null = null;
  try {
    const sent = await provider.send({
      from: inbox.email,
      fromName: inbox.displayName || undefined,
      to: message.toEmail,
      subject: email.subject,
      text: email.text,
      html: email.html ?? undefined,
    });
    providerMessageId = sent.providerMessageId ?? null;
  } catch (err) {
    if (err instanceof ProviderError) return handleProviderError(message, inbox, err, now);
    // We do not know whether the email left. Never retry automatically: a human checks the Sent folder.
    return fail(message, inbox, {
      code: "UNKNOWN_STATE",
      message: `The send ended in an unknown way: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }

  // ---- Success ----
  const sentAt = new Date();
  // Inbox first: the planner must see the new lastSentAt as soon as the slot frees up (gap rule).
  await Inbox.updateOne(
    { _id: inbox._id },
    { $set: { lastSentAt: sentAt, consecutiveFailures: 0 } },
  );
  const done = await Message.findOneAndUpdate(
    { _id: message._id, status: "sending" },
    {
      $set: {
        status: "sent",
        sentAt,
        renderedSubject: email.subject,
        providerMessageId,
        lockedUntil: null,
        error: null,
      },
    },
  );
  if (!done) {
    log.error(`message ${String(message._id)} was no longer 'sending' after a successful send`);
    return "failed";
  }
  await logEvent("message.sent", `Sent to ${message.toEmail} from ${inbox.email}`, {
    campaignId: message.campaignId,
    inboxId: inbox._id,
    messageId: message._id,
    domainId: inbox.domainId,
  });
  return "sent";
}

type InboxRecord = {
  _id: Types.ObjectId;
  email: string;
  domainId: Types.ObjectId;
  providerConnectionId?: Types.ObjectId | null;
};

/** sending → failed, plus the inbox failure counter. */
async function fail(
  message: MessageRecord,
  inbox: InboxRecord,
  error: { code: string; message: string },
  options: { countAgainstInbox?: boolean } = {},
): Promise<Outcome> {
  await Message.findOneAndUpdate(
    { _id: message._id, status: "sending" },
    { $set: { status: "failed", lockedUntil: null, error } },
  );
  await logEvent("message.failed", `Failed to send to ${message.toEmail}: ${error.code}`, {
    campaignId: message.campaignId,
    inboxId: inbox._id,
    messageId: message._id,
  });
  if (options.countAgainstInbox !== false) await recordInboxFailure(inbox);
  return "failed";
}

async function handleProviderError(
  message: MessageRecord,
  inbox: InboxRecord,
  error: ProviderError,
  now: Date,
): Promise<Outcome> {
  const decision = classifyRetry(message.attempts, error, now);
  const info = { code: error.code, message: error.message };

  if (decision.action === "retry") {
    // Back to `scheduled` for the same inbox (it keeps its one in-flight slot).
    const retried = await Message.findOneAndUpdate(
      { _id: message._id, status: "sending" },
      {
        $set: {
          status: "scheduled",
          scheduledAt: decision.retryAt,
          lockedUntil: null,
          error: info,
        },
      },
    );
    if (retried) {
      await logEvent(
        "message.retry",
        `Temporary error sending to ${message.toEmail} (${error.code}); retrying at ${decision.retryAt.toISOString()}`,
        { campaignId: message.campaignId, inboxId: inbox._id, messageId: message._id },
      );
    }
    await recordInboxFailure(inbox);
    return "retried";
  }

  // An address that does not exist is the recipient's problem, not the inbox's.
  const countAgainstInbox = !error.invalidRecipient;
  const outcome = await fail(message, inbox, info, { countAgainstInbox });

  if (decision.action === "fail_and_suppress") {
    await Suppression.updateOne(
      { email: message.toEmail },
      {
        $setOnInsert: {
          email: message.toEmail,
          reason: "bounced",
          note: "Address rejected by the mail provider",
        },
      },
      { upsert: true },
    );
    await syncContactsWithSuppressions([message.toEmail], "bounced");
    await logEvent(
      "suppression.added",
      `${message.toEmail} added to the suppression list (bounced)`,
      {
        campaignId: message.campaignId,
      },
    );
  }

  if (decision.action === "fail_and_pause_connection" && inbox.providerConnectionId) {
    await pauseConnection(inbox.providerConnectionId, error.message);
  }
  return outcome;
}

/** 401/403: the connection's credentials or permissions are broken → mark it `error`, pause every inbox that uses it. */
async function pauseConnection(connectionId: Types.ObjectId, reason: string) {
  await ProviderConnection.updateOne(
    { _id: connectionId },
    { $set: { status: "error", lastError: reason, lastCheckedAt: new Date() } },
  );
  const inboxes = await Inbox.find({
    providerConnectionId: connectionId,
    status: "active",
    deletedAt: null,
  })
    .select("email domainId")
    .lean();
  for (const inbox of inboxes) {
    const paused = await Inbox.findOneAndUpdate(
      { _id: inbox._id, status: "active" },
      { $set: { status: "paused", pauseReason: `The provider connection failed: ${reason}` } },
    );
    if (paused) {
      await releaseScheduledMessages({ inboxIds: [inbox._id] });
      await logEvent(
        "inbox.auto_paused",
        `Inbox ${inbox.email} paused: the provider connection failed`,
        {
          inboxId: inbox._id,
          domainId: inbox.domainId,
        },
      );
    }
  }
  await logEvent("provider.error", `Provider connection marked as error: ${reason}`);
}

/** +1 consecutive failure; at 5 in a row the inbox is paused automatically. */
async function recordInboxFailure(inbox: InboxRecord) {
  const updated = await Inbox.findOneAndUpdate(
    { _id: inbox._id },
    { $inc: { consecutiveFailures: 1 } },
    { returnDocument: "after" },
  );
  if (!updated || updated.consecutiveFailures < AUTO_PAUSE_AFTER_FAILURES) return;
  const paused = await Inbox.findOneAndUpdate(
    { _id: inbox._id, status: "active" },
    {
      $set: {
        status: "paused",
        pauseReason: `Paused automatically after ${AUTO_PAUSE_AFTER_FAILURES} failed sends in a row`,
      },
    },
  );
  if (paused) {
    await releaseScheduledMessages({ inboxIds: [inbox._id] });
    await logEvent(
      "inbox.auto_paused",
      `Inbox ${inbox.email} paused automatically after ${AUTO_PAUSE_AFTER_FAILURES} failures in a row`,
      {
        inboxId: inbox._id,
        domainId: inbox.domainId,
      },
    );
  }
}
