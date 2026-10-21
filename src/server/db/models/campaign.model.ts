import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { CAMPAIGN_STATUSES, DEFAULTS } from "@/shared/enums";
import { deletedAtField } from "@/server/db/soft-delete";

const MINUTES_PER_DAY = 1440;

const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    listId: { type: Schema.Types.ObjectId, ref: "List", required: true },
    inboxIds: { type: [{ type: Schema.Types.ObjectId, ref: "Inbox" }], default: [] },
    // May be empty while the campaign is a draft; Start refuses an empty subject or body.
    subjectTemplate: { type: String, default: "" },
    bodyTemplate: { type: String, default: "" }, // plain text
    bodyHtml: { type: String, default: null }, // optional
    sendWindow: {
      // minutes after midnight in the app timezone, e.g. 600 = 10:00
      startMinute: {
        type: Number,
        default: DEFAULTS.sendWindow.startMinute,
        min: 0,
        max: MINUTES_PER_DAY,
      },
      endMinute: {
        type: Number,
        default: DEFAULTS.sendWindow.endMinute,
        min: 0,
        max: MINUTES_PER_DAY,
      },
      // 1 = Monday … 7 = Sunday
      days: {
        type: [{ type: Number, min: 1, max: 7 }],
        default: () => [...DEFAULTS.sendWindow.days],
      },
    },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: "draft" },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "campaigns" },
);

campaignSchema.index({ status: 1 });

export type CampaignDoc = InferSchemaType<typeof campaignSchema>;
export const Campaign: Model<CampaignDoc> =
  (mongoose.models.Campaign as Model<CampaignDoc>) ||
  mongoose.model<CampaignDoc>("Campaign", campaignSchema);
