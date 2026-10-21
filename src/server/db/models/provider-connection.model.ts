import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { PROVIDER_STATUSES, PROVIDER_TYPES } from "@/shared/enums";
import { deletedAtField } from "@/server/db/soft-delete";

const providerConnectionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: PROVIDER_TYPES, required: true },
    tenantId: { type: String, trim: true },
    clientId: { type: String, trim: true },
    // Encrypted with src/server/lib/crypto.ts. select:false = never loaded unless asked for explicitly.
    clientSecretEnc: { type: String, select: false },
    status: { type: String, enum: PROVIDER_STATUSES, default: "unchecked" },
    lastCheckedAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    deletedAt: deletedAtField,
  },
  { timestamps: true, collection: "providerConnections" },
);

export type ProviderConnectionDoc = InferSchemaType<typeof providerConnectionSchema>;
export const ProviderConnection: Model<ProviderConnectionDoc> =
  (mongoose.models.ProviderConnection as Model<ProviderConnectionDoc>) ||
  mongoose.model<ProviderConnectionDoc>("ProviderConnection", providerConnectionSchema);
