import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { CONTACT_STATUSES } from "@/shared/enums";
import { deletedAtField } from "@/server/db/soft-delete";

const contactSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    firstName: { type: String, default: "", trim: true },
    lastName: { type: String, default: "", trim: true },
    company: { type: String, default: "", trim: true },
    title: { type: String, default: "", trim: true },
    // Extra CSV columns, used in templates as {{custom.<key>}}
    custom: { type: Map, of: String, default: {} },
    listIds: { type: [{ type: Schema.Types.ObjectId, ref: "List" }], default: [] },
    status: { type: String, enum: CONTACT_STATUSES, default: "active" },
    // What this person did, from Sent Items, replies and link clicks (engagement.service.ts keeps it
    // up to date; `npm run tracking:rebuild` recalculates it from scratch).
    engagement: {
      emailsSent: { type: Number, default: 0 },
      lastEmailedAt: { type: Date, default: null },
      replyCount: { type: Number, default: 0 },
      lastRepliedAt: { type: Date, default: null },
      /** Every open of their links, bots included. */
      clickCount: { type: Number, default: 0 },
      /** Opens judged to be a real person. */
      realClickCount: { type: Number, default: 0 },
      /** Last real-person click. */
      lastClickedAt: { type: Date, default: null },
    },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "contacts" },
);

// Unique across ALL contacts (also soft-deleted ones): one person = one contact record.
contactSchema.index({ email: 1 }, { unique: true });
contactSchema.index({ listIds: 1 });

export type ContactDoc = InferSchemaType<typeof contactSchema>;
export const Contact: Model<ContactDoc> =
  (mongoose.models.Contact as Model<ContactDoc>) ||
  mongoose.model<ContactDoc>("Contact", contactSchema);
