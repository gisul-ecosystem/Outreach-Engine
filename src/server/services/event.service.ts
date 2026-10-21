import type { Types } from "mongoose";
import { Event } from "@/server/db/models";
import { createLogger } from "@/server/lib/logger";

const log = createLogger("events");

type Refs = Partial<
  Record<"campaignId" | "inboxId" | "messageId" | "domainId", Types.ObjectId | string | null>
>;

/** Writes to the activity log (shown on the dashboard). Never throws: logging must not break the action. */
export async function logEvent(type: string, message: string, refs: Refs = {}): Promise<void> {
  try {
    await Event.create({ type, message, refs });
  } catch (err) {
    log.warn(`could not write event ${type}`, err instanceof Error ? err.message : err);
  }
}
