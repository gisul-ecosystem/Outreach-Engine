import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { MESSAGE_STATUSES } from "@/shared/enums";

// One message per campaign × contact. This collection IS the send queue (BUILD_PLAN section 5).
const messageSchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    toEmail: { type: String, required: true, lowercase: true, trim: true },
    inboxId: { type: Schema.Types.ObjectId, ref: "Inbox", default: null }, // null until scheduled
    status: { type: String, enum: MESSAGE_STATUSES, default: "pending" },
    scheduledAt: { type: Date, default: null },
    lockedUntil: { type: Date, default: null },
    attempts: { type: Number, default: 0, min: 0 },
    sentAt: { type: Date, default: null },
    renderedSubject: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    // Which template version this contact gets (0 = the campaign's main template) and its name, for logs.
    variantIndex: { type: Number, default: 0, min: 0 },
    templateName: { type: String, default: null },
    // The Message-ID header it was sent with: links bounce reports and follow-ups back to it.
    // Outlook format: Microsoft makes it, so it is filled in later from Sent Items (null until then).
    internetMessageId: { type: String, default: null },
    // "outlook" or "mime": how it was handed to Microsoft (null for emails sent before this existed).
    sendFormat: { type: String, default: null },
    // Follow-ups only: the first email this one answers, and the inbox that must send it.
    parentMessageId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
    parentInboxId: { type: Schema.Types.ObjectId, ref: "Inbox", default: null },
    // Set by the mailbox reader.
    repliedAt: { type: Date, default: null },
    bounce: {
      type: new Schema({ code: String, message: String, at: Date }, { _id: false }),
      default: null,
    },
    error: {
      type: new Schema({ code: String, message: String }, { _id: false }),
      default: null,
    },
  },
  { timestamps: true, collection: "messages" },
);

// Safety rule: never send the same campaign to the same contact twice.
messageSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });
messageSchema.index({ status: 1, scheduledAt: 1 });
messageSchema.index({ inboxId: 1, sentAt: -1 });
messageSchema.index({ campaignId: 1, status: 1 });
// Dashboard counts: sent today / this week / total, per-inbox sent today, sent-per-day chart.
messageSchema.index({ status: 1, sentAt: -1 });
// Mailbox reader: find the email a bounce report or a reply belongs to.
messageSchema.index({ internetMessageId: 1 });
messageSchema.index({ toEmail: 1, inboxId: 1 });
// Safety rule (BUILD_PLAN section 6): at most ONE message per inbox is 'scheduled' or 'sending' at any time.
// The planner checks this too; the database enforces it so even a bug or a race cannot break it.
messageSchema.index(
  { inboxId: 1 },
  {
    unique: true,
    name: "one_in_flight_per_inbox",
    partialFilterExpression: { status: { $in: ["scheduled", "sending"] } },
  },
);

export type MessageDoc = InferSchemaType<typeof messageSchema>;
export const Message: Model<MessageDoc> =
  (mongoose.models.Message as Model<MessageDoc>) ||
  mongoose.model<MessageDoc>("Message", messageSchema);
