import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { CAMPAIGN_STATUSES, DEFAULTS } from "@/shared/enums";
import { deletedAtField } from "@/server/db/soft-delete";

const MINUTES_PER_DAY = 1440;

// An extra email version of the campaign (template rotation). See campaignTemplates() in the campaign service.
const variantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    subjectTemplate: { type: String, default: "" },
    bodyTemplate: { type: String, default: "" },
    bodyHtml: { type: String, default: null },
    // Contacts whose `variantColumn` value contains one of these words get this version.
    matchValues: { type: [String], default: [] },
  },
  { _id: false },
);

const campaignSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    listId: { type: Schema.Types.ObjectId, ref: "List", required: true },
    inboxIds: { type: [{ type: Schema.Types.ObjectId, ref: "Inbox" }], default: [] },
    // May be empty while the campaign is a draft; Start refuses an empty subject or body.
    subjectTemplate: { type: String, default: "" },
    bodyTemplate: { type: String, default: "" }, // plain text
    bodyHtml: { type: String, default: null }, // optional; made from the text when empty
    // Name of the main template (shown in logs); empty = the campaign name.
    templateName: { type: String, default: "", trim: true },
    // ---- Template rotation (optional) ----
    // Contact field that picks the version, e.g. "custom.segment" or "title".
    variantColumn: { type: String, default: "", trim: true },
    // Words in variantColumn that pick the MAIN template (e.g. ["ai", "ml"]).
    matchValues: { type: [String], default: [] },
    variants: { type: [variantSchema], default: [] },
    // ---- Follow-up (optional) ----
    // Set = this campaign is the single follow-up of that campaign: it only emails people who got the
    // first email at least `followUpAfterDays` ago and did not reply, in the same thread, from the same inbox.
    followUpOf: { type: Schema.Types.ObjectId, ref: "Campaign", default: null },
    followUpAfterDays: { type: Number, default: 3, min: 1, max: 30 },
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
    // Why the engine paused it by itself (stop-on-error); null when paused by a person.
    pauseReason: { type: String, default: null },
    // Failed sends in a row; at 3 the campaign pauses itself.
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Last "Send test to myself" of this campaign's email (readiness check).
    testSentAt: { type: Date, default: null },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "campaigns" },
);

campaignSchema.index({ status: 1 });
campaignSchema.index({ followUpOf: 1 });

export type CampaignDoc = InferSchemaType<typeof campaignSchema>;
export const Campaign: Model<CampaignDoc> =
  (mongoose.models.Campaign as Model<CampaignDoc>) ||
  mongoose.model<CampaignDoc>("Campaign", campaignSchema);
