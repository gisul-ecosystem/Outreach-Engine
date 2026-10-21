import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { SUPPRESSION_REASONS } from "@/shared/enums";

// People we must never email. Not soft-deleted: removing a suppression is a deliberate hard delete.
const suppressionSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    reason: { type: String, enum: SUPPRESSION_REASONS, required: true },
    note: { type: String, default: "", trim: true },
  },
  { timestamps: true, collection: "suppressions" },
);

suppressionSchema.index({ email: 1 }, { unique: true });

export type SuppressionDoc = InferSchemaType<typeof suppressionSchema>;
export const Suppression: Model<SuppressionDoc> =
  (mongoose.models.Suppression as Model<SuppressionDoc>) ||
  mongoose.model<SuppressionDoc>("Suppression", suppressionSchema);
