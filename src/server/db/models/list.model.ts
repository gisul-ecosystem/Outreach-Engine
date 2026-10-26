import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { deletedAtField } from "@/server/db/soft-delete";

const listSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    /**
     * Last tracking-link choice for this list (set at import / links download), so downloading the
     * links again gives the same links: where they lead, and which sending domain they are made for.
     */
    linkDestinationUrl: { type: String, default: null },
    linkDomainId: { type: Schema.Types.ObjectId, ref: "Domain", default: null },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "lists" },
);

export type ListDoc = InferSchemaType<typeof listSchema>;
export const List: Model<ListDoc> =
  (mongoose.models.List as Model<ListDoc>) || mongoose.model<ListDoc>("List", listSchema);
