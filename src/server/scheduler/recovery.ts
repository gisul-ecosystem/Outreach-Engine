// Recovery tick (every 60 s): finds messages stuck in `sending` (the worker crashed mid-send).
// We cannot know whether such an email left, so it is NEVER sent again automatically:
// it is marked `failed` with code UNKNOWN_STATE for a human to check (CLAUDE.md safety rule).
import { Message } from "@/server/db/models";
import { logEvent } from "@/server/services/event.service";

export const UNKNOWN_STATE_MESSAGE =
  "The worker stopped while sending this email, so it is unknown whether it was delivered. Check the inbox's Sent folder before sending again.";

export async function recoveryTick(now = new Date()): Promise<{ recovered: number }> {
  const stuck = await Message.find({ status: "sending", lockedUntil: { $lt: now } })
    .select("_id")
    .lean();

  let recovered = 0;
  for (const { _id } of stuck) {
    // The filter repeats the conditions, so a message that finished in the meantime is left alone.
    const message = await Message.findOneAndUpdate(
      { _id, status: "sending", lockedUntil: { $lt: now } },
      {
        $set: {
          status: "failed",
          lockedUntil: null,
          error: { code: "UNKNOWN_STATE", message: UNKNOWN_STATE_MESSAGE },
        },
      },
    );
    if (!message) continue;
    recovered++;
    await logEvent(
      "message.unknown_state",
      `Message to ${message.toEmail} was stuck while sending → failed (UNKNOWN_STATE)`,
      {
        campaignId: message.campaignId,
        inboxId: message.inboxId,
        messageId: message._id,
      },
    );
  }
  return { recovered };
}
