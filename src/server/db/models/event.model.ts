import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const NINETY_DAYS_IN_SECONDS = 90 * 24 * 60 * 60;

// Activity log for the dashboard and debugging. MongoDB deletes events automatically after 90 days.
const eventSchema = new Schema(
  {
    type: { type: String, required: true }, // e.g. "message.sent", "inbox.auto_paused"
    refs: {
      campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", default: null },
      inboxId: { type: Schema.Types.ObjectId, ref: "Inbox", default: null },
      messageId: { type: Schema.Types.ObjectId, ref: "Message", default: null },
      domainId: { type: Schema.Types.ObjectId, ref: "Domain", default: null },
    },
    message: { type: String, default: "" },
  },
  { timestamps: true, collection: "events" },
);

eventSchema.index({ createdAt: 1 }, { expireAfterSeconds: NINETY_DAYS_IN_SECONDS });

export type EventDoc = InferSchemaType<typeof eventSchema>;
export const Event: Model<EventDoc> =
  (mongoose.models.Event as Model<EventDoc>) || mongoose.model<EventDoc>("Event", eventSchema);
