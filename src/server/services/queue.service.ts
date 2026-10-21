import type { Types } from "mongoose";
import { Message } from "@/server/db/models";

/**
 * Puts `scheduled` messages back to `pending` (clears inbox + time) so the planner can re-plan them.
 * Used when a campaign, inbox or domain is paused or deleted (BUILD_PLAN section 6).
 * Messages already `sending` are left alone — the sender/recovery tick handles those.
 */
export async function releaseScheduledMessages(filter: {
  inboxIds?: (Types.ObjectId | string)[];
  campaignId?: Types.ObjectId | string;
}): Promise<number> {
  const match: Record<string, unknown> = { status: "scheduled" };
  if (filter.inboxIds) match.inboxId = { $in: filter.inboxIds };
  if (filter.campaignId) match.campaignId = filter.campaignId;
  if (!filter.inboxIds && !filter.campaignId) return 0;

  const result = await Message.updateMany(match, {
    $set: { status: "pending", inboxId: null, scheduledAt: null },
  });
  return result.modifiedCount;
}
