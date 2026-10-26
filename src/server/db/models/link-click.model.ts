import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { CLICK_VERDICTS } from "@/shared/enums";

const ONE_YEAR_IN_SECONDS = 365 * 24 * 60 * 60;

// Every open of a tracking link, with the verdict (real person / maybe a bot / bot) and why.
// No raw IP address is ever stored: only `ipHash` (HMAC-SHA256 with TRACKING_IP_SECRET).
// MongoDB deletes clicks automatically after one year; the link and contact counters keep their totals.
const linkClickSchema = new Schema(
  {
    linkId: { type: Schema.Types.ObjectId, ref: "TrackedLink", required: true },
    token: { type: String, required: true },
    contactId: { type: Schema.Types.ObjectId, ref: "Contact", required: true },
    at: { type: Date, required: true },
    method: { type: String, required: true }, // GET or HEAD
    userAgent: { type: String, default: "", maxlength: 300 },
    /** Scrambled visitor IP (can't be turned back into the IP); null when TRACKING_IP_SECRET is not set. */
    ipHash: { type: String, default: null },
    verdict: { type: String, enum: CLICK_VERDICTS, required: true },
    /** Plain-English reasons, e.g. "Probably a security scanner: opened 4 seconds after sending." */
    reasons: { type: [String], default: [] },
    reasonCodes: { type: [String], default: [] },
    /** What the verdict was based on, so it can be judged again once we learn when the email was sent. */
    signals: {
      hasAcceptLanguage: { type: Boolean, default: false },
      hasSecFetch: { type: Boolean, default: false },
      recentSameLink: { type: Number, default: 1 },
      otherContactsSameVisitor: { type: Number, default: 0 },
    },
    secondsSinceSent: { type: Number, default: null },
  },
  { timestamps: true, collection: "linkClicks" },
);

linkClickSchema.index({ at: 1 }, { expireAfterSeconds: ONE_YEAR_IN_SECONDS });
linkClickSchema.index({ linkId: 1, at: -1 });
linkClickSchema.index({ contactId: 1, at: -1 });
linkClickSchema.index({ verdict: 1, at: -1 });
linkClickSchema.index({ ipHash: 1, at: -1 });

export type LinkClickDoc = InferSchemaType<typeof linkClickSchema>;
export const LinkClick: Model<LinkClickDoc> =
  (mongoose.models.LinkClick as Model<LinkClickDoc>) ||
  mongoose.model<LinkClickDoc>("LinkClick", linkClickSchema);
