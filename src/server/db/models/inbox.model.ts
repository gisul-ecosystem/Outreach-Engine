import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DEFAULTS, INBOX_STATUSES } from "@/shared/enums";
import { deletedAtField, onlyNotDeleted } from "@/server/db/soft-delete";

// Rule (enforced in the inbox service, Phase 3): the email's domain must equal its domain's name.
const inboxSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    // What recipients see in "From", e.g. "Name from Company".
    displayName: { type: String, default: "", trim: true },
    // Signature values for templates: {{senderName}} (falls back to displayName) and {{senderRole}}.
    senderName: { type: String, default: "", trim: true },
    senderRole: { type: String, default: "", trim: true },
    domainId: { type: Schema.Types.ObjectId, ref: "Domain", required: true },
    providerConnectionId: { type: Schema.Types.ObjectId, ref: "ProviderConnection", default: null },
    // Optional Microsoft connection that READS this mailbox (bounces + replies) when the sending one
    // cannot, e.g. sent through ZeptoMail while replies arrive in Outlook. null = read with the sender.
    readingConnectionId: { type: Schema.Types.ObjectId, ref: "ProviderConnection", default: null },
    status: { type: String, enum: INBOX_STATUSES, default: "active" },
    pauseReason: { type: String, default: null },
    dailyLimit: { type: Number, default: DEFAULTS.dailyLimit, min: 1 },
    minGapSeconds: { type: Number, default: DEFAULTS.minGapSeconds, min: 0 },
    maxGapSeconds: { type: Number, default: DEFAULTS.maxGapSeconds, min: 0 },
    lastSentAt: { type: Date, default: null },
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    // The mailbox reader (bounces + replies) has looked at emails received up to this moment.
    mailboxCheckedAt: { type: Date, default: null },
    // The Sent Items tracker (emails sent by hand + by the engine) has read emails sent up to this moment.
    sentItemsCheckedAt: { type: Date, default: null },
    // The same tracker has read the Inbox for replies to those emails up to this moment.
    repliesCheckedAt: { type: Date, default: null },
    // The same tracker has stored the Inbox folder's emails (the Inbox page) up to this moment.
    incomingCheckedAt: { type: Date, default: null },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "inboxes" },
);

inboxSchema.index({ email: 1 }, { unique: true, ...onlyNotDeleted });
inboxSchema.index({ domainId: 1 });

export type InboxDoc = InferSchemaType<typeof inboxSchema>;
export const Inbox: Model<InboxDoc> =
  (mongoose.models.Inbox as Model<InboxDoc>) || mongoose.model<InboxDoc>("Inbox", inboxSchema);
