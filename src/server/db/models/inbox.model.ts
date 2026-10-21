import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DEFAULTS, INBOX_STATUSES } from "@/shared/enums";
import { deletedAtField, onlyNotDeleted } from "@/server/db/soft-delete";

// Rule (enforced in the inbox service, Phase 3): the email's domain must equal its domain's name.
const inboxSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    displayName: { type: String, default: "", trim: true },
    domainId: { type: Schema.Types.ObjectId, ref: "Domain", required: true },
    providerConnectionId: { type: Schema.Types.ObjectId, ref: "ProviderConnection", default: null },
    status: { type: String, enum: INBOX_STATUSES, default: "active" },
    pauseReason: { type: String, default: null },
    dailyLimit: { type: Number, default: DEFAULTS.dailyLimit, min: 1 },
    minGapSeconds: { type: Number, default: DEFAULTS.minGapSeconds, min: 0 },
    maxGapSeconds: { type: Number, default: DEFAULTS.maxGapSeconds, min: 0 },
    lastSentAt: { type: Date, default: null },
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "inboxes" },
);

inboxSchema.index({ email: 1 }, { unique: true, ...onlyNotDeleted });
inboxSchema.index({ domainId: 1 });

export type InboxDoc = InferSchemaType<typeof inboxSchema>;
export const Inbox: Model<InboxDoc> =
  (mongoose.models.Inbox as Model<InboxDoc>) || mongoose.model<InboxDoc>("Inbox", inboxSchema);
