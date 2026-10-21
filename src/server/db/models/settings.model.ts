import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";
import { DEFAULTS } from "@/shared/enums";

// Single document (created by `npm run seed`). Also holds the worker heartbeat and single-worker lock.
const settingsSchema = new Schema(
  {
    timezone: { type: String, default: DEFAULTS.timezone },
    defaultDailyLimit: { type: Number, default: DEFAULTS.dailyLimit, min: 1 },
    defaultMinGapSeconds: { type: Number, default: DEFAULTS.minGapSeconds, min: 0 },
    defaultMaxGapSeconds: { type: Number, default: DEFAULTS.maxGapSeconds, min: 0 },
    workerHeartbeatAt: { type: Date, default: null },
    workerLockId: { type: String, default: null },
    workerLockExpiresAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "settings" },
);

export type SettingsDoc = InferSchemaType<typeof settingsSchema>;
export const Settings: Model<SettingsDoc> =
  (mongoose.models.Settings as Model<SettingsDoc>) ||
  mongoose.model<SettingsDoc>("Settings", settingsSchema);
