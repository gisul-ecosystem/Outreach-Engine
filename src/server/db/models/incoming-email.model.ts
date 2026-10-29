import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { INCOMING_EMAIL_KINDS } from "@/shared/enums";

// Every email found in an attached inbox's Inbox folder (the Inbox page): replies, bounces,
// auto-replies and anything else. Read-only copy of what Microsoft has; it never drives sending
// (replies and bounces are acted on by the mailbox / Sent Items ticks).
const incomingEmailSchema = new Schema(
  {
    inboxId: { type: Schema.Types.ObjectId, ref: "Inbox", required: true },
    /** Copy of the inbox address, so the list still reads well after the inbox is deleted. */
    inboxEmail: { type: String, required: true, lowercase: true, trim: true },
    /** Graph id of the email (unique per mailbox). */
    providerMessageId: { type: String, required: true },
    conversationId: { type: String, default: null },
    kind: { type: String, enum: INCOMING_EMAIL_KINDS, required: true },
    fromEmail: { type: String, default: "", lowercase: true, trim: true },
    fromName: { type: String, default: "" },
    subject: { type: String, default: "" },
    /** Only the new part of a reply (without the quoted earlier email), as plain text. */
    text: { type: String, default: "" },
    /** The whole body as plain text (capped). */
    body: { type: String, default: "" },
    receivedAt: { type: Date, required: true },
    /** Reply to a campaign email: that email, its campaign and the contact. */
    messageId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", default: null },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", default: null },
  },
  { timestamps: true, collection: "incomingEmails" },
);

// The same email is stored once per inbox, however many times the reader sees it.
incomingEmailSchema.index({ inboxId: 1, providerMessageId: 1 }, { unique: true });
incomingEmailSchema.index({ receivedAt: -1 });
incomingEmailSchema.index({ kind: 1, receivedAt: -1 });
incomingEmailSchema.index({ inboxId: 1, receivedAt: -1 });
incomingEmailSchema.index({ contactId: 1 });

export type IncomingEmailDoc = InferSchemaType<typeof incomingEmailSchema>;
export const IncomingEmail: Model<IncomingEmailDoc> =
  (mongoose.models.IncomingEmail as Model<IncomingEmailDoc>) ||
  mongoose.model<IncomingEmailDoc>("IncomingEmail", incomingEmailSchema);
