// Stores every email found in an inbox's Inbox folder (the Inbox page), each marked as a reply,
// bounce, auto-reply or other. Called by the Sent Items tick with the emails it already read for
// reply detection, so Microsoft is not asked twice. Read-only: it never sends, deletes or suppresses.
import type { Types } from "mongoose";
import { Contact, IncomingEmail, Message, TrackedEmail } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { isAutoReply, isBounceReport } from "@/server/lib/bounce";
import type { ReceivedEmail } from "@/server/providers";
import type { IncomingEmailKind } from "@/shared/enums";

/** Bodies are kept as plain text, cut to these lengths (a long thread quotes every earlier email). */
const MAX_TEXT = 20_000;
const MAX_BODY = 50_000;

type Link = {
  messageId: Types.ObjectId | null;
  campaignId: Types.ObjectId | null;
  contactId: Types.ObjectId | null;
};
const NO_LINK: Link = { messageId: null, campaignId: null, contactId: null };

/** Stores the emails of one inbox that are not stored yet. Returns how many were new. */
export async function recordIncomingEmails(
  inbox: { _id: Types.ObjectId; email: string },
  emails: ReceivedEmail[],
  ownAddresses: Set<string>,
): Promise<number> {
  if (emails.length === 0) return 0;
  const stored = new Set(
    (
      await IncomingEmail.find({
        inboxId: inbox._id,
        providerMessageId: { $in: emails.map((e) => e.id) },
      })
        .select("providerMessageId")
        .lean()
    ).map((e) => e.providerMessageId),
  );
  const fresh = emails.filter((e) => !stored.has(e.id));
  if (fresh.length === 0) return 0;

  const docs = [];
  for (const email of fresh) {
    const { kind, link } = await classify(inbox, email, ownAddresses);
    docs.push({
      inboxId: inbox._id,
      inboxEmail: inbox.email,
      providerMessageId: email.id,
      conversationId: email.conversationId ?? null,
      kind,
      fromEmail: email.fromEmail,
      fromName: email.fromName,
      subject: email.subject,
      text: email.uniqueBody.slice(0, MAX_TEXT),
      body: email.body.slice(0, MAX_BODY),
      receivedAt: email.receivedAt,
      ...link,
    });
  }
  const write = await IncomingEmail.bulkWrite(
    docs.map((doc) => ({
      updateOne: {
        filter: {
          inboxId: inbox._id,
          providerMessageId: doc.providerMessageId,
        },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  return write.upsertedCount;
}

/**
 * reply = from someone this inbox emailed before (a campaign email, or one sent by hand in Outlook,
 * same thread or same address). Bounce reports and auto-replies are told apart first.
 */
async function classify(
  inbox: { _id: Types.ObjectId; email: string },
  email: ReceivedEmail,
  ownAddresses: Set<string>,
): Promise<{ kind: IncomingEmailKind; link: Link }> {
  if (isBounceReport(email)) return { kind: "bounce", link: NO_LINK };
  if (isAutoReply(email)) return { kind: "auto_reply", link: NO_LINK };
  if (!email.fromEmail || email.fromEmail === inbox.email || ownAddresses.has(email.fromEmail)) {
    return { kind: "other", link: NO_LINK };
  }

  const contact = await Contact.findOne(notDeleted({ email: email.fromEmail }))
    .select("_id")
    .lean();
  const message = await Message.findOne({
    inboxId: inbox._id,
    toEmail: email.fromEmail,
    status: "sent",
    sentAt: { $lte: email.receivedAt },
  })
    .sort({ sentAt: -1 })
    .select("_id campaignId contactId")
    .lean();
  if (message) {
    return {
      kind: "reply",
      link: {
        messageId: message._id,
        campaignId: message.campaignId ?? null,
        contactId: message.contactId ?? contact?._id ?? null,
      },
    };
  }
  const tracked = await TrackedEmail.exists({
    inboxId: inbox._id,
    sentAt: { $lte: email.receivedAt },
    $or: [
      ...(email.conversationId ? [{ conversationId: email.conversationId }] : []),
      { recipients: email.fromEmail },
    ],
  });
  if (tracked)
    return {
      kind: "reply",
      link: { ...NO_LINK, contactId: contact?._id ?? null },
    };
  return {
    kind: "other",
    link: { ...NO_LINK, contactId: contact?._id ?? null },
  };
}
