// Sent Items tick (every 5 minutes): for every attached inbox
//   1. reads its Sent Items folder and stores each email in `trackedEmails` — who it went to (To/CC/BCC),
//      when, and whether it was typed by hand in Outlook ("manual") or sent by the worker ("engine").
//      Tracking-link tokens in the body are noted (the body itself is never stored); a link that belongs
//      to someone who is not a recipient is flagged as a wrong link.
//   2. reads its Inbox for REPLIES to those emails (same thread, or from one of the recipients).
//      A reply like "no" / "unsubscribe" → never emailed again (suppression "unsubscribed").
//   - first look: 30 days back; after that it carries on from where the last look stopped
//   - emails newer than 2 minutes are left for the next look (the worker may still be saving its own send)
//   - runs in every mode, DRY_RUN included: it only READS (needs Mail.Read), it never sends or deletes.
//     MAILBOX_READING=false switches it off (`npm run simulate` does, so a simulation never calls Microsoft).
//   - it never touches `messages` (the send queue): tracked emails can never be sent or re-sent
import { Types } from "mongoose";
import { getEnv } from "@/server/config/env";
import {
  Contact,
  Inbox,
  Message,
  ProviderConnection,
  TrackedEmail,
  TrackedLink,
} from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { isAutoReply, isBounceReport, isOptOutReply } from "@/server/lib/bounce";
import { createLogger } from "@/server/lib/logger";
import {
  getVerificationProvider,
  ProviderError,
  type EmailProvider,
  type ReceivedEmail,
  type SentItem,
} from "@/server/providers";
import { reclassifyLinkClicks } from "@/server/services/click.service";
import { refreshEngagement } from "@/server/services/engagement.service";
import { logEvent } from "@/server/services/event.service";
import { suppressOptOutReply } from "@/server/services/suppression.service";
import type { TrackedEmailSource } from "@/shared/enums";
import { matchSentEmails, READABLE_INBOX, readingConnectionOf } from "./mailbox";

const log = createLogger("sent-items");

/** First look at a newly attached inbox: this far back. */
export const SENT_ITEMS_FIRST_LOOK_MS = 30 * 24 * 60 * 60 * 1000;
/** Emails sent in the last 2 minutes wait for the next look (the worker saves its send right after Microsoft accepts it). */
const SETTLE_MS = 2 * 60 * 1000;
/** Each look re-reads a little of the previous one, in case Microsoft shows an email late. */
const OVERLAP_MS = 10 * 60 * 1000;
/** Engine messages this close to a Sent Items email are candidates for "this was the engine". */
const ENGINE_LOOKUP_MS = 60 * 60 * 1000;

export type SentItemsResult = {
  inboxes: number;
  manual: number;
  engine: number;
  replies: number;
  optOuts: number;
};

/** "Cannot read …" is logged once per inbox per worker run, not every 5 minutes. */
const warned = new Set<string>();

type InboxRow = {
  _id: Types.ObjectId;
  email: string;
  providerConnectionId?: Types.ObjectId | null;
  readingConnectionId?: Types.ObjectId | null;
  sentItemsCheckedAt?: Date | null;
  repliesCheckedAt?: Date | null;
};

export async function sentItemsTick(
  now = new Date(),
  options: { provider?: (connection: { _id: Types.ObjectId }) => EmailProvider } = {},
): Promise<SentItemsResult> {
  const result: SentItemsResult = { inboxes: 0, manual: 0, engine: 0, replies: 0, optOuts: 0 };
  if (!getEnv().MAILBOX_READING) return result;

  const inboxes = await Inbox.find(notDeleted(READABLE_INBOX))
    .select("email providerConnectionId readingConnectionId sentItemsCheckedAt repliesCheckedAt")
    .lean<InboxRow[]>();
  // Emails between our own inboxes are not replies from the people we email.
  const ownAddresses = new Set(inboxes.map((i) => i.email));

  for (const inbox of inboxes) {
    const connection = await ProviderConnection.findOne(
      notDeleted({ _id: readingConnectionOf(inbox) }),
    )
      .select("+clientSecretEnc")
      .lean();
    if (!connection) continue;
    const until = new Date(now.getTime() - SETTLE_MS);
    const sinceFor = (checkedAt?: Date | null) =>
      checkedAt
        ? new Date(checkedAt.getTime() - OVERLAP_MS)
        : new Date(now.getTime() - SENT_ITEMS_FIRST_LOOK_MS);

    let provider: EmailProvider;
    try {
      provider = options.provider?.(connection) ?? getVerificationProvider(connection);
      // 1. Sent Items
      const since = sinceFor(inbox.sentItemsCheckedAt);
      if (provider.listSentItems && until > since) {
        const page = await provider.listSentItems(inbox.email, since, until);
        const added = await recordSentItems(inbox, page.items);
        result.manual += added.manual;
        result.engine += added.engine;
        // More emails than one look can read: carry on next time right after the last one read
        // (checkpoint + OVERLAP_MS so the next look starts exactly at that email).
        const last = page.items.at(-1);
        const checkpoint =
          page.complete || !last
            ? until
            : new Date(Math.min(until.getTime(), last.sentAt.getTime() + OVERLAP_MS));
        await Inbox.updateOne({ _id: inbox._id }, { $set: { sentItemsCheckedAt: checkpoint } });
      }
      // 2. Replies in the Inbox
      const repliesSince = sinceFor(inbox.repliesCheckedAt);
      if (until > repliesSince) {
        const received = await provider.listReceivedEmails(inbox.email, repliesSince);
        const replies = await recordReplies(inbox, received, ownAddresses);
        result.replies += replies.replies;
        result.optOuts += replies.optOuts;
        await Inbox.updateOne({ _id: inbox._id }, { $set: { repliesCheckedAt: now } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!warned.has(String(inbox._id))) {
        warned.add(String(inbox._id));
        await logEvent(
          "sentitems.read_failed",
          `Cannot read the mailbox ${inbox.email}: ${message}`,
          {
            inboxId: inbox._id,
          },
        );
      }
      if (!(err instanceof ProviderError)) log.error(`reading ${inbox.email} failed`, message);
      continue;
    }
    warned.delete(String(inbox._id));
    result.inboxes++;
  }
  return result;
}

/** Stores new Sent Items emails of one inbox (already stored ones are skipped). Returns how many were new. */
export async function recordSentItems(
  inbox: Pick<InboxRow, "_id" | "email">,
  items: SentItem[],
): Promise<{ manual: number; engine: number }> {
  const withRecipients = items
    .map((item) => ({ item, recipients: recipientsOf(item, inbox.email) }))
    .filter((r) => r.recipients.length > 0); // an email only to the inbox itself is not "sent to someone"
  if (withRecipients.length === 0) return { manual: 0, engine: 0 };

  const engineIds = await findEngineMessages(
    inbox,
    withRecipients.map((r) => r.item),
  );
  const contactIdsByEmail = await contactsByEmail(withRecipients.flatMap((r) => r.recipients));
  // Only tokens of links that really exist are kept (a "/r/…" in some other URL is ignored).
  const linksByToken = new Map(
    (
      await TrackedLink.find({ token: { $in: withRecipients.flatMap((r) => r.item.linkTokens) } })
        .select("_id token contactId")
        .lean()
    ).map((l) => [l.token, l]),
  );

  const docs = withRecipients.map(({ item, recipients }) => {
    const messageId = engineIds.get(item.internetMessageId) ?? null;
    const contactIds = recipients.flatMap((email) => contactIdsByEmail.get(email) ?? []);
    const links = item.linkTokens.flatMap((t) => linksByToken.get(t) ?? []);
    const isRecipient = (id: Types.ObjectId) => contactIds.some((c) => c.equals(id));
    return {
      source: (messageId ? "engine" : "manual") as TrackedEmailSource,
      links,
      doc: {
        _id: new Types.ObjectId(),
        inboxId: inbox._id,
        inboxEmail: inbox.email,
        source: messageId ? "engine" : "manual",
        messageId,
        internetMessageId: item.internetMessageId,
        providerMessageId: item.id,
        conversationId: item.conversationId,
        subject: item.subject,
        to: item.to,
        cc: item.cc,
        bcc: item.bcc,
        recipients,
        contactIds,
        sentAt: item.sentAt,
        tokens: links.map((l) => l.token),
        wrongLinks: links
          .filter((l) => !isRecipient(l.contactId))
          .map((l) => ({ token: l.token, contactId: l.contactId })),
      },
    };
  });

  const write = await TrackedEmail.bulkWrite(
    docs.map(({ doc }) => ({
      updateOne: {
        filter: { inboxId: inbox._id, internetMessageId: doc.internetMessageId },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  const added = { manual: 0, engine: 0 };
  const newDocs = Object.keys(write.upsertedIds).map((index) => docs[Number(index)]);
  for (const d of newDocs) added[d.source]++;
  if (newDocs.length === 0) return added;

  log.info(`${inbox.email}: ${newDocs.length} new sent email(s) tracked (${added.manual} by hand)`);
  await linkEmailsToLinks(newDocs);
  for (const d of newDocs) {
    if (d.doc.wrongLinks.length) {
      await logEvent(
        "tracking.wrong_link",
        `Wrong link: an email from ${inbox.email} to ${d.doc.recipients.join(", ")} contains someone else's tracking link`,
        { inboxId: inbox._id },
      );
    }
  }
  await refreshEngagement(newDocs.flatMap((d) => d.doc.contactIds));
  return added;
}

/** Notes on each link which emails it was sent in (and when), then re-judges its earlier clicks. */
async function linkEmailsToLinks(
  newDocs: { links: { _id: Types.ObjectId }[]; doc: { _id: Types.ObjectId; sentAt: Date } }[],
) {
  const linkIds = new Map<string, Types.ObjectId>();
  for (const { links, doc } of newDocs) {
    for (const link of links) {
      linkIds.set(String(link._id), link._id);
      await TrackedLink.updateOne(
        { _id: link._id },
        { $addToSet: { sentEmailIds: doc._id }, $max: { lastSentAt: doc.sentAt } },
      );
      // $min would keep an empty date (null sorts before every date), so set it only when empty or later.
      await TrackedLink.updateOne(
        {
          _id: link._id,
          $or: [{ firstSentAt: null }, { firstSentAt: { $gt: doc.sentAt } }],
        },
        { $set: { firstSentAt: doc.sentAt } },
      );
    }
  }
  // A scanner may have opened the link seconds after sending — before we knew when it was sent.
  await reclassifyLinkClicks([...linkIds.values()]);
}

/**
 * Replies to tracked emails of this inbox: same thread (Graph conversationId), or from one of the
 * recipients. Auto-replies, bounce reports and emails from our own inboxes are ignored.
 */
export async function recordReplies(
  inbox: Pick<InboxRow, "_id" | "email">,
  emails: ReceivedEmail[],
  ownAddresses: Set<string>,
): Promise<{ replies: number; optOuts: number }> {
  const counts = { replies: 0, optOuts: 0 };
  const contactIds: Types.ObjectId[] = [];
  for (const email of emails) {
    if (!email.fromEmail || ownAddresses.has(email.fromEmail) || email.fromEmail === inbox.email) {
      continue;
    }
    if (isAutoReply(email) || isBounceReport(email)) continue;

    const filter = {
      inboxId: inbox._id,
      sentAt: { $lte: email.receivedAt },
      $or: [
        ...(email.conversationId ? [{ conversationId: email.conversationId }] : []),
        { recipients: email.fromEmail },
      ],
    };
    const replied = await TrackedEmail.find({ ...filter, repliedAt: null })
      .select("_id contactIds")
      .lean();
    if (replied.length === 0) continue; // not a reply to us, or seen in an earlier look

    await TrackedEmail.updateMany(
      { _id: { $in: replied.map((r) => r._id) }, repliedAt: null },
      { $set: { repliedAt: email.receivedAt, replyFromEmail: email.fromEmail } },
    );
    contactIds.push(...replied.flatMap((r) => r.contactIds));
    counts.replies++;
    await logEvent("tracked.replied", `${email.fromEmail} replied to ${inbox.email}`, {
      inboxId: inbox._id,
    });
    if (isOptOutReply(email) && (await suppressOptOutReply(email.fromEmail, email.uniqueBody))) {
      counts.optOuts++;
    }
  }
  await refreshEngagement(contactIds);
  return counts;
}

/** to + cc + bcc, lowercase, without duplicates and without the inbox itself. */
export function recipientsOf(item: Pick<SentItem, "to" | "cc" | "bcc">, inboxEmail: string) {
  const self = inboxEmail.toLowerCase();
  return [...new Set([...item.to, ...item.cc, ...item.bcc].map((e) => e.toLowerCase()))].filter(
    (e) => e && e !== self,
  );
}

/**
 * Which of these Sent Items emails the worker sent: by Message-ID or Graph id first, then (Outlook
 * format, whose Message-ID may not be known yet) by recipient + subject + time, like the mailbox tick.
 * Returns internetMessageId → engine message id.
 */
async function findEngineMessages(
  inbox: Pick<InboxRow, "_id">,
  items: SentItem[],
): Promise<Map<string, Types.ObjectId>> {
  const found = new Map<string, Types.ObjectId>();
  const byIds = await Message.find({
    inboxId: inbox._id,
    $or: [
      { internetMessageId: { $in: items.map((i) => i.internetMessageId) } },
      { providerMessageId: { $in: items.map((i) => i.id) } },
    ],
  })
    .select("_id internetMessageId providerMessageId")
    .lean();
  const used = new Set<string>();
  for (const item of items) {
    const message = byIds.find(
      (m) => m.internetMessageId === item.internetMessageId || m.providerMessageId === item.id,
    );
    if (message && !used.has(String(message._id))) {
      found.set(item.internetMessageId, message._id);
      used.add(String(message._id));
    }
  }

  const rest = items.filter((i) => !found.has(i.internetMessageId));
  if (rest.length === 0) return found;
  const times = rest.map((i) => i.sentAt.getTime());
  const candidates = await Message.find({
    inboxId: inbox._id,
    status: "sent",
    internetMessageId: null,
    sentAt: {
      $gte: new Date(Math.min(...times) - ENGINE_LOOKUP_MS),
      $lte: new Date(Math.max(...times) + ENGINE_LOOKUP_MS),
    },
  })
    .select("_id toEmail renderedSubject sentAt")
    .lean<
      { _id: Types.ObjectId; toEmail: string; renderedSubject?: string | null; sentAt: Date }[]
    >();
  // A message already linked to a tracked email (seen in an earlier look) is not used again.
  const linked = new Set(
    (
      await TrackedEmail.distinct("messageId", {
        messageId: { $in: candidates.map((c) => c._id) },
      })
    ).map(String),
  );
  const free = candidates.filter((c) => !linked.has(String(c._id)) && !used.has(String(c._id)));
  for (const match of matchSentEmails(free, rest)) {
    found.set(match.internetMessageId, match.messageId);
  }
  return found;
}

/** email → contact ids (contacts are unique by email; soft-deleted ones are left out). */
async function contactsByEmail(emails: string[]): Promise<Map<string, Types.ObjectId[]>> {
  const contacts = await Contact.find(notDeleted({ email: { $in: [...new Set(emails)] } }))
    .select("_id email")
    .lean();
  const map = new Map<string, Types.ObjectId[]>();
  for (const c of contacts) map.set(c.email, [...(map.get(c.email) ?? []), c._id]);
  return map;
}
