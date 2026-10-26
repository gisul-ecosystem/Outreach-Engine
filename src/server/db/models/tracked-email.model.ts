import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { TRACKED_EMAIL_SOURCES } from "@/shared/enums";

// Every email found in an attached inbox's Sent Items folder — typed by hand in Outlook ("manual")
// or sent by the worker ("engine"). Read-only copy of what Microsoft has; it never drives sending
// (the send queue is `messages`). Kept forever, like messages, so day/week/month counts survive.
const trackedEmailSchema = new Schema(
  {
    inboxId: { type: Schema.Types.ObjectId, ref: "Inbox", required: true },
    /** Copy of the inbox address, so the list still reads well after the inbox is deleted. */
    inboxEmail: { type: String, required: true, lowercase: true, trim: true },
    source: { type: String, enum: TRACKED_EMAIL_SOURCES, required: true },
    /** The engine message it belongs to (source "engine" only). */
    messageId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    /** Microsoft's Message-ID header, e.g. <abc@x.prod.outlook.com>. */
    internetMessageId: { type: String, required: true },
    /** Graph id of the email in Sent Items (changes if the email is moved to another folder). */
    providerMessageId: { type: String, default: null },
    /** Graph's thread id: replies in the same thread share it. */
    conversationId: { type: String, default: null },
    subject: { type: String, default: "" },
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
    bcc: { type: [String], default: [] },
    /** to + cc + bcc without duplicates or the inbox itself — the people this email went to. */
    recipients: { type: [String], default: [] },
    /** Recipients that are contacts in the engine (matched by email when the email was found). */
    contactIds: { type: [Schema.Types.ObjectId], ref: "Contact", default: [] },
    sentAt: { type: Date, required: true },
    /** First reply in this email's thread (or from one of its recipients). */
    repliedAt: { type: Date, default: null },
    replyFromEmail: { type: String, default: null },
    /** Tracking-link tokens found in the body (the body itself is never stored). */
    tokens: { type: [String], default: [] },
    /** A link belonging to someone who is NOT a recipient of this email (pasted into the wrong email). */
    wrongLinks: {
      type: [
        {
          _id: false,
          token: { type: String, required: true },
          contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, collection: "trackedEmails" },
);

// The same email is stored once per inbox, however many times the reader sees it.
trackedEmailSchema.index({ inboxId: 1, internetMessageId: 1 }, { unique: true });
trackedEmailSchema.index({ sentAt: -1 });
trackedEmailSchema.index({ source: 1, sentAt: -1 });
trackedEmailSchema.index({ inboxId: 1, sentAt: -1 });
trackedEmailSchema.index({ recipients: 1 });
trackedEmailSchema.index({ contactIds: 1 });
trackedEmailSchema.index({ tokens: 1 });
trackedEmailSchema.index({ conversationId: 1 });

export type TrackedEmailDoc = InferSchemaType<typeof trackedEmailSchema>;
export const TrackedEmail: Model<TrackedEmailDoc> =
  (mongoose.models.TrackedEmail as Model<TrackedEmailDoc>) ||
  mongoose.model<TrackedEmailDoc>("TrackedEmail", trackedEmailSchema);
