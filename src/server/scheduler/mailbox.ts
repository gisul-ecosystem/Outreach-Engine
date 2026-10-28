// Mailbox tick (every 5 minutes): reads each sending inbox for bounce reports and replies.
//   - bounce ("Undeliverable…", from postmaster / MAILER-DAEMON) → saved on the email it belongs to;
//       address not found (5.1.1…)            → never emailed again (suppression "bounced")
//       sender blocked (5.7.705 / 5.7.708 / 5.1.8) → campaign AND inbox paused + alert
//   - reply from someone we emailed → their emails are marked replied (no follow-up);
//       a reply like "no" / "unsubscribe"   → never emailed again (suppression "unsubscribed")
//   - Outlook-format emails: Microsoft gives them their Message-ID, so it is read from Sent Items and
//       saved on the email (bounces and follow-ups use it). Done first, before bounces are matched.
// Read-only towards Microsoft: it never sends or deletes anything. Needs the Mail.Read permission.
// An inbox with a reading connection is read through it (e.g. sent via ZeptoMail, replies in Outlook).
import type { Types } from "mongoose";
import { Inbox, Message, ProviderConnection, Suppression } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import {
  BAD_RECIPIENT_CODES,
  CRITICAL_BOUNCE_CODES,
  isAutoReply,
  isOptOutReply,
  parseBounce,
  type Bounce,
} from "@/server/lib/bounce";
import { createLogger } from "@/server/lib/logger";
import {
  getVerificationProvider,
  ProviderError,
  sendingMode,
  type EmailProvider,
  type ReceivedEmail,
  type SentEmail,
} from "@/server/providers";
import { autoPauseCampaign } from "@/server/services/campaign.service";
import { logEvent } from "@/server/services/event.service";
import { releaseScheduledMessages } from "@/server/services/queue.service";
import {
  suppressOptOutReply,
  syncContactsWithSuppressions,
} from "@/server/services/suppression.service";

const log = createLogger("mailbox");

/** First look: this far back. Later looks overlap the previous one a little, in case of clock skew. */
const FIRST_LOOK_MS = 7 * 24 * 60 * 60 * 1000;
const OVERLAP_MS = 10 * 60 * 1000;
/** Outlook-format emails look for their Message-ID in Sent Items for this long after sending. */
const SENT_LOOKUP_MS = 7 * 24 * 60 * 60 * 1000;
/** Microsoft's "sent" time may be a little before or after ours (we note the time after it accepted). */
const SENT_BEFORE_MS = 5 * 60 * 1000;
const SENT_AFTER_MS = 30 * 60 * 1000;

export type MailboxResult = { inboxes: number; bounces: number; replies: number; optOuts: number };

/** "Mail.Read is missing" is logged once per inbox per worker run, not every 5 minutes. */
const warned = new Set<string>();

type InboxRow = {
  _id: Types.ObjectId;
  email: string;
  domainId: Types.ObjectId;
  providerConnectionId?: Types.ObjectId | null;
  readingConnectionId?: Types.ObjectId | null;
  mailboxCheckedAt?: Date | null;
};

/** Inboxes with a connection that can read them (the sending one, or a separate reading one). */
export const READABLE_INBOX = {
  $or: [{ providerConnectionId: { $ne: null } }, { readingConnectionId: { $ne: null } }],
};

/**
 * The connection that READS an inbox: its reading connection when set (e.g. sent through ZeptoMail,
 * replies arrive in Outlook), else the one it sends with.
 */
export function readingConnectionOf(inbox: {
  providerConnectionId?: Types.ObjectId | null;
  readingConnectionId?: Types.ObjectId | null;
}): Types.ObjectId | null {
  return inbox.readingConnectionId ?? inbox.providerConnectionId ?? null;
}

export async function mailboxTick(
  now = new Date(),
  options: { provider?: (connection: { _id: Types.ObjectId }) => EmailProvider } = {},
): Promise<MailboxResult> {
  const result: MailboxResult = { inboxes: 0, bounces: 0, replies: 0, optOuts: 0 };
  // Nothing is really sent in a dry run, so there is nothing to read back.
  if (sendingMode() === "dry-run") return result;

  const inboxes = await Inbox.find(notDeleted(READABLE_INBOX))
    .select("email domainId providerConnectionId readingConnectionId mailboxCheckedAt")
    .lean<InboxRow[]>();
  for (const inbox of inboxes) {
    const connection = await ProviderConnection.findOne(
      notDeleted({ _id: readingConnectionOf(inbox) }),
    )
      .select("+clientSecretEnc")
      .lean();
    if (!connection) continue;
    const since = inbox.mailboxCheckedAt
      ? new Date(inbox.mailboxCheckedAt.getTime() - OVERLAP_MS)
      : new Date(now.getTime() - FIRST_LOOK_MS);

    let emails: ReceivedEmail[];
    try {
      const provider = options.provider?.(connection) ?? getVerificationProvider(connection);
      // Failing here (e.g. no Mail.Read) must not stop bounce reading; the Inbox read below reports it.
      await resolveSentMessageIds(inbox, provider, now).catch((err: unknown) => {
        if (!(err instanceof ProviderError)) {
          log.error(`Sent Items of ${inbox.email}`, err instanceof Error ? err.message : err);
        }
      });
      emails = await provider.listReceivedEmails(inbox.email, since);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!warned.has(String(inbox._id))) {
        warned.add(String(inbox._id));
        await logEvent("mailbox.read_failed", `Cannot read ${inbox.email}: ${message}`, {
          inboxId: inbox._id,
        });
      }
      if (!(err instanceof ProviderError)) log.error(`reading ${inbox.email} failed`, message);
      continue;
    }
    warned.delete(String(inbox._id));
    result.inboxes++;

    for (const email of emails) {
      const bounce = parseBounce(email);
      if (bounce) {
        if (await handleBounce(inbox, email, bounce)) result.bounces++;
        continue;
      }
      const reply = await handleReply(inbox, email);
      if (reply) result.replies++;
      if (reply === "opt-out") result.optOuts++;
    }
    await Inbox.updateOne({ _id: inbox._id }, { $set: { mailboxCheckedAt: now } });
  }
  return result;
}

/** "RE: Fw: Hello  there" → "hello there" (Exchange adds "RE:" to replies). */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

type WaitingMessage = {
  _id: Types.ObjectId;
  toEmail: string;
  renderedSubject?: string | null;
  sentAt?: Date | null;
};

/**
 * Pairs our sent emails with the emails in Sent Items (pure): same recipient, same subject
 * (ignoring "RE:"), sent close to our time; the closest one wins and each is used once.
 */
export function matchSentEmails(
  waiting: WaitingMessage[],
  sentItems: SentEmail[],
): { messageId: Types.ObjectId; internetMessageId: string; providerMessageId: string }[] {
  const used = new Set<string>();
  const matches = [];
  for (const message of waiting) {
    if (!message.sentAt) continue;
    const at = message.sentAt.getTime();
    const subject = normalizeSubject(message.renderedSubject ?? "");
    const best = sentItems
      .filter(
        (s) =>
          !used.has(s.internetMessageId) &&
          s.to.includes(message.toEmail) &&
          normalizeSubject(s.subject) === subject &&
          s.sentAt.getTime() >= at - SENT_BEFORE_MS &&
          s.sentAt.getTime() <= at + SENT_AFTER_MS,
      )
      .sort((a, b) => Math.abs(a.sentAt.getTime() - at) - Math.abs(b.sentAt.getTime() - at))[0];
    if (!best) continue;
    used.add(best.internetMessageId);
    matches.push({
      messageId: message._id,
      internetMessageId: best.internetMessageId,
      providerMessageId: best.id,
    });
  }
  return matches;
}

/**
 * Outlook format: Graph's sendMail answers "202 Accepted" without the Message-ID Microsoft gives the
 * email, so it is read from Sent Items afterwards (Mail.Read) and saved with the email's Graph id
 * (a follow-up replies to that id). Without Mail.Read this throws and the email keeps
 * internetMessageId = null: bounces then fall back to matching by recipient address.
 */
export async function resolveSentMessageIds(
  inbox: Pick<InboxRow, "_id" | "email">,
  provider: EmailProvider,
  now = new Date(),
): Promise<number> {
  if (!provider.listSentEmails) return 0;
  const waiting = await Message.find({
    inboxId: inbox._id,
    status: "sent",
    sendFormat: "outlook",
    internetMessageId: null,
    sentAt: { $gte: new Date(now.getTime() - SENT_LOOKUP_MS) },
  })
    .select("toEmail renderedSubject sentAt")
    .sort({ sentAt: 1 })
    .limit(200)
    .lean<WaitingMessage[]>();
  if (waiting.length === 0) return 0;

  const since = new Date(waiting[0].sentAt!.getTime() - SENT_BEFORE_MS);
  const sentItems = await provider.listSentEmails(inbox.email, since);
  // An email in Sent Items that already belongs to one of our messages is not used again.
  const taken = new Set<string>(
    await Message.distinct("internetMessageId", {
      internetMessageId: { $in: sentItems.map((s) => s.internetMessageId) },
    }),
  );
  const matches = matchSentEmails(
    waiting,
    sentItems.filter((s) => !taken.has(s.internetMessageId)),
  );
  for (const match of matches) {
    await Message.updateOne(
      { _id: match.messageId, internetMessageId: null },
      {
        $set: {
          internetMessageId: match.internetMessageId,
          providerMessageId: match.providerMessageId,
        },
      },
    );
  }
  if (matches.length) log.info(`${inbox.email}: Message-ID found for ${matches.length} email(s)`);
  return matches.length;
}

/** Finds the email that bounced: by its Message-ID, else the latest one sent from this inbox to an address in the report. */
async function findBouncedMessage(inbox: InboxRow, bounce: Bounce, receivedAt: Date) {
  if (bounce.originalMessageId) {
    const byId = await Message.findOne({ internetMessageId: bounce.originalMessageId });
    if (byId) return byId;
  }
  const recipients = bounce.addresses.filter((a) => a !== inbox.email);
  if (recipients.length === 0) return null;
  return Message.findOne({
    inboxId: inbox._id,
    toEmail: { $in: recipients },
    status: "sent",
    sentAt: { $lte: receivedAt },
  }).sort({ sentAt: -1 });
}

/** Returns true when this bounce was new (not seen in an earlier look). */
async function handleBounce(
  inbox: InboxRow,
  email: ReceivedEmail,
  bounce: Bounce,
): Promise<boolean> {
  const message = await findBouncedMessage(inbox, bounce, email.receivedAt);
  const detail = `${bounce.smtp}${bounce.reason ? ` — ${bounce.reason}` : ""}`;
  const critical = CRITICAL_BOUNCE_CODES.includes(bounce.code);

  if (message) {
    if (message.bounce?.code) return false; // already handled
    message.bounce = { code: bounce.code, message: detail, at: email.receivedAt };
    await message.save();
    await logEvent(
      "message.bounced",
      `Bounce ${bounce.smtp} for ${message.toEmail} from ${inbox.email}`,
      {
        campaignId: message.campaignId,
        inboxId: inbox._id,
        messageId: message._id,
      },
    );
    log.warn(`bounce ${bounce.smtp} for ${message.toEmail} (from ${inbox.email})`);

    if (BAD_RECIPIENT_CODES.includes(bounce.code)) {
      await Suppression.updateOne(
        { email: message.toEmail },
        {
          $setOnInsert: {
            email: message.toEmail,
            reason: "bounced",
            note: `Hard bounce ${bounce.smtp}`,
          },
        },
        { upsert: true },
      );
      await syncContactsWithSuppressions([message.toEmail], "bounced");
      await logEvent(
        "suppression.added",
        `${message.toEmail} added to the suppression list (bounced ${bounce.code})`,
        {
          campaignId: message.campaignId,
        },
      );
    }
    if (critical) {
      await autoPauseCampaign(
        message.campaignId,
        `Microsoft rejected an email with ${detail}. Check the Microsoft 365 account before resuming.`,
      );
    }
  } else if (!critical) {
    return false; // a bounce for something we did not send (e.g. a manual email) — not ours to handle
  }

  if (critical) await pauseInboxForBounce(inbox, bounce, detail);
  return true;
}

/** 5.7.705 blocks the whole Microsoft account → every inbox on that connection; otherwise just this one. */
async function pauseInboxForBounce(inbox: InboxRow, bounce: Bounce, detail: string) {
  const filter =
    bounce.code === "5.7.705" && inbox.providerConnectionId
      ? notDeleted({ providerConnectionId: inbox.providerConnectionId, status: "active" })
      : { _id: inbox._id, status: "active" };
  const targets = await Inbox.find(filter).select("_id email domainId").lean();
  for (const target of targets) {
    const paused = await Inbox.findOneAndUpdate(
      { _id: target._id, status: "active" },
      { $set: { status: "paused", pauseReason: `Paused automatically: bounce ${detail}` } },
    );
    if (!paused) continue;
    await releaseScheduledMessages({ inboxIds: [target._id] });
    await logEvent(
      "inbox.auto_paused",
      `ALERT: inbox ${target.email} paused — Microsoft bounced an email with ${bounce.smtp}`,
      { inboxId: target._id, domainId: target.domainId },
    );
  }
}

/** A reply from someone this inbox emailed. Returns what it was, or null if it is not a reply to us. */
async function handleReply(
  inbox: InboxRow,
  email: ReceivedEmail,
): Promise<"reply" | "opt-out" | null> {
  if (!email.fromEmail || email.fromEmail === inbox.email || isAutoReply(email)) return null;
  const filter = {
    inboxId: inbox._id,
    toEmail: email.fromEmail,
    status: "sent" as const,
    sentAt: { $lte: email.receivedAt },
  };
  const first = await Message.findOne(filter).select("campaignId").lean();
  if (!first) return null;

  const marked = await Message.updateMany(
    { ...filter, repliedAt: null },
    { $set: { repliedAt: email.receivedAt } },
  );
  const optOut = isOptOutReply(email);
  if (optOut) {
    await suppressOptOutReply(email.fromEmail, email.uniqueBody, { campaignId: first.campaignId });
  }
  if (marked.modifiedCount === 0) return null; // seen in an earlier look
  await logEvent("message.replied", `${email.fromEmail} replied to ${inbox.email}`, {
    campaignId: first.campaignId,
    inboxId: inbox._id,
  });
  return optOut ? "opt-out" : "reply";
}
