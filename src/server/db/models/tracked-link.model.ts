import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { deletedAtField } from "@/server/db/soft-delete";

// One tracking link per contact per destination per link host: https://go.racko.ai/r/<token> → destinationUrl.
// The counters are kept here so lists stay fast; `npm run tracking:rebuild` recalculates them from linkClicks.
const trackedLinkSchema = new Schema(
  {
    /** Random, unguessable, never contains personal data (src/server/tracking/token.ts). */
    token: { type: String, required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    /** Where the link leads (https, host on TRACKING_ALLOWED_HOSTS — checked again at every click). */
    destinationUrl: { type: String, required: true },
    /**
     * Host the link was made for, e.g. "go.tryracko.in" (a sending domain's tracking address), so the
     * link's domain matches the email's. null = TRACKING_BASE_URL (and every link made before this field).
     * Clicks are found by token only, so any host that reaches the engine works.
     */
    trackingHost: { type: String, default: null },
    /** The words shown for the link when it is pasted into Outlook, e.g. "take a look at Racko". */
    label: { type: String, default: "", trim: true },
    /** Hand-sent emails (trackedEmails) this link was found in. */
    sentEmailIds: { type: [Schema.Types.ObjectId], ref: "TrackedEmail", default: [] },
    firstSentAt: { type: Date, default: null },
    lastSentAt: { type: Date, default: null },
    /** Every open, bots included. */
    clickCount: { type: Number, default: 0, min: 0 },
    /** Opens judged to be a real person (verdict "click"). */
    realClickCount: { type: Number, default: 0, min: 0 },
    firstRealClickAt: { type: Date, default: null },
    lastClickAt: { type: Date, default: null },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "trackedLinks" },
);

trackedLinkSchema.index({ token: 1 }, { unique: true });
// "Get the newest link of this contact for this destination" (Copy link reuses it).
trackedLinkSchema.index({ contactId: 1, destinationUrl: 1, createdAt: -1 });

export type TrackedLinkDoc = InferSchemaType<typeof trackedLinkSchema>;
export const TrackedLink: Model<TrackedLinkDoc> =
  (mongoose.models.TrackedLink as Model<TrackedLinkDoc>) ||
  mongoose.model<TrackedLinkDoc>("TrackedLink", trackedLinkSchema);
