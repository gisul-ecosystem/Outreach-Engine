import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { deletedAtField } from "@/server/db/soft-delete";

const listSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "lists" },
);

export type ListDoc = InferSchemaType<typeof listSchema>;
export const List: Model<ListDoc> =
  (mongoose.models.List as Model<ListDoc>) || mongoose.model<ListDoc>("List", listSchema);
