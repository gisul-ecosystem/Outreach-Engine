// Planner tick (every 30 s): decides WHICH email each inbox sends next and WHEN (BUILD_PLAN section 6).
// It never sends anything — it only moves one `pending` message per inbox to `scheduled`.
import type { Types } from "mongoose";
import {
  Campaign,
  Contact,
  Domain,
  Inbox,
  Message,
  ProviderConnection,
  Suppression,
  type CampaignDoc,
} from "@/server/db/models";
import { createLogger } from "@/server/lib/logger";
import { sendingMode } from "@/server/providers";
import { syncFollowUpMessages } from "@/server/services/campaign.service";
import { logEvent } from "@/server/services/event.service";
import { getTimezone } from "@/server/services/settings.service";
import { canInboxSendNow, computeNextSendAt, contactBlockReason, randomGapSeconds } from "./rules";
import { startOfDayInTz, type SendWindow } from "./time";

const log = createLogger("planner");
const DUPLICATE_KEY = 11000;
/** Safety cap: how many unsendable (suppressed…) messages one inbox may skip in a single tick. */
const MAX_SKIPS_PER_INBOX = 200;

export type PlannerResult = { scheduled: number; skipped: number; completed: number };

type Lean<T> = T & { _id: Types.ObjectId };

export async function plannerTick(now = new Date()): Promise<PlannerResult> {
  const result: PlannerResult = { scheduled: 0, skipped: 0, completed: 0 };
  // Kill switch: SENDING_ENABLED=false with DRY_RUN=false → plan nothing, send nothing.
  if (sendingMode() === "disabled") return result;

  const tz = await getTimezone();
  const campaigns = await Campaign.find({ status: "running", deletedAt: null }).lean();
  for (const campaign of campaigns) {
    try {
      await planCampaign(campaign as Lean<typeof campaign>, now, tz, result);
    } catch (err) {
      log.error(
        `campaign ${String(campaign._id)} failed`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return result;
}

async function planCampaign(
  campaign: Lean<
    CampaignDoc & {
      inboxIds: Types.ObjectId[];
      name: string;
      sendWindow?: { startMinute: number; endMinute: number; days: number[] } | null;
    }
  >,
  now: Date,
  tz: string,
  result: PlannerResult,
) {
  // A follow-up campaign gets new messages as people become due (first email ≥ N days ago, no reply).
  if (campaign.followUpOf) await syncFollowUpMessages(campaign, now);

  const window: SendWindow = {
    startMinute: campaign.sendWindow?.startMinute ?? 0,
    endMinute: campaign.sendWindow?.endMinute ?? 0,
    days: [...(campaign.sendWindow?.days ?? [])],
  };
  // In DRY_RUN the FakeProvider needs no real Microsoft connection, so an unverified one is fine.
  const requireConnected = sendingMode() === "live";

  const inboxes = await Inbox.find({ _id: { $in: campaign.inboxIds } }).lean();
  // Round robin: the inbox that has waited longest (or never sent) goes first.
  inboxes.sort((a, b) => (a.lastSentAt?.getTime() ?? 0) - (b.lastSentAt?.getTime() ?? 0));
  const domains = new Map(
    (await Domain.find({ _id: { $in: inboxes.map((i) => i.domainId) } }).lean()).map((d) => [
      String(d._id),
      d,
    ]),
  );
  const connectionIds = inboxes.flatMap((i) =>
    i.providerConnectionId ? [i.providerConnectionId] : [],
  );
  const connections = new Map(
    (await ProviderConnection.find({ _id: { $in: connectionIds } }).lean()).map((c) => [
      String(c._id),
      c,
    ]),
  );
  const dayStart = startOfDayInTz(now, tz);

  for (const inbox of inboxes) {
    const domain = domains.get(String(inbox.domainId)) ?? null;
    const connection = inbox.providerConnectionId
      ? (connections.get(String(inbox.providerConnectionId)) ?? null)
      : null;

    // Rules 1 + 2 first (no database needed), then 3 + 4.
    const quick = canInboxSendNow(inbox, domain, connection, 0, false, now, window, tz, {
      requireConnected,
    });
    if (!quick.ok) continue;

    const inFlight = await Message.exists({
      inboxId: inbox._id,
      status: { $in: ["scheduled", "sending"] },
    });
    const sentToday = await Message.countDocuments({
      inboxId: inbox._id,
      status: "sent",
      sentAt: { $gte: dayStart },
    });
    const verdict = canInboxSendNow(
      inbox,
      domain,
      connection,
      sentToday,
      inFlight !== null,
      now,
      window,
      tz,
      { requireConnected },
    );
    if (!verdict.ok) continue;

    // Read lastSentAt only now: a send that finished a moment ago must count for the gap.
    const fresh = await Inbox.findById(inbox._id).select("lastSentAt status").lean();
    if (!fresh || fresh.status !== "active") continue;
    const gap = randomGapSeconds(inbox.minGapSeconds, inbox.maxGapSeconds);
    const nextAt = computeNextSendAt(now, fresh.lastSentAt, gap, window, tz);
    if (!nextAt) continue; // finished for today

    const outcome = await scheduleOneMessage(
      campaign._id,
      inbox._id,
      nextAt,
      result,
      !!campaign.followUpOf,
    );
    if (outcome === "scheduled") result.scheduled++;
  }

  // Rule 7: nothing pending / scheduled / sending left → the campaign is done.
  // A follow-up is only done when its first campaign is finished and nobody can still become due.
  const open = await Message.exists({
    campaignId: campaign._id,
    status: { $in: ["pending", "scheduled", "sending"] },
  });
  if (!open && (await followUpStillWaiting(campaign, now))) return;
  if (!open) {
    const done = await Campaign.findOneAndUpdate(
      { _id: campaign._id, status: "running" },
      { $set: { status: "completed", completedAt: now } },
    );
    if (done) {
      result.completed++;
      await logEvent("campaign.completed", `Campaign "${campaign.name}" completed`, {
        campaignId: campaign._id,
      });
    }
  }
}

/** True while a follow-up campaign may still get new people (its first campaign is not finished yet). */
async function followUpStillWaiting(
  campaign: { followUpOf?: Types.ObjectId | null; followUpAfterDays?: number | null },
  now: Date,
): Promise<boolean> {
  if (!campaign.followUpOf) return false;
  const parent = await Campaign.findById(campaign.followUpOf).select("status deletedAt").lean();
  if (parent && !parent.deletedAt && parent.status !== "completed") return true;
  const cutoff = new Date(now.getTime() - (campaign.followUpAfterDays ?? 3) * 24 * 60 * 60 * 1000);
  // Someone got the first email less than N days ago and has not answered: wait for them.
  return (
    (await Message.exists({
      campaignId: campaign.followUpOf,
      status: "sent",
      sentAt: { $gt: cutoff },
      repliedAt: null,
      bounce: null,
    })) !== null
  );
}

/**
 * Atomically claims ONE `pending` message of the campaign for this inbox (pending → scheduled).
 * Messages that must not be emailed (suppressed, unsubscribed, bounced, deleted) become `skipped` on the way.
 * A follow-up only takes messages whose first email came from this inbox (same sender, same thread).
 */
async function scheduleOneMessage(
  campaignId: Types.ObjectId,
  inboxId: Types.ObjectId,
  scheduledAt: Date,
  result: PlannerResult,
  isFollowUp = false,
): Promise<"scheduled" | "none"> {
  const filter = {
    campaignId,
    status: "pending" as const,
    ...(isFollowUp ? { parentInboxId: inboxId } : {}),
  };
  for (let i = 0; i < MAX_SKIPS_PER_INBOX; i++) {
    const candidate = await Message.findOne(filter).lean();
    if (!candidate) return "none";

    const [contact, suppressed] = await Promise.all([
      Contact.findById(candidate.contactId).select("status deletedAt").lean(),
      Suppression.exists({ email: candidate.toEmail }),
    ]);
    const blocked = contactBlockReason(contact, suppressed !== null);
    if (blocked) {
      const skipped = await Message.findOneAndUpdate(
        { _id: candidate._id, status: "pending" },
        { $set: { status: "skipped", error: blocked } },
      );
      if (skipped) result.skipped++;
      continue;
    }

    let claimed;
    try {
      claimed = await Message.findOneAndUpdate(
        { _id: candidate._id, status: "pending" },
        { $set: { status: "scheduled", inboxId, scheduledAt, lockedUntil: null } },
        { returnDocument: "after" },
      );
    } catch (err) {
      // The unique "one in flight per inbox" index says this inbox already has a message → nothing to do.
      if ((err as { code?: number }).code === DUPLICATE_KEY) return "none";
      throw err;
    }
    if (!claimed) continue; // someone else changed it; try the next pending message

    // The campaign may have been paused while we were working: give the message back.
    const stillRunning = await Campaign.exists({ _id: campaignId, status: "running" });
    if (!stillRunning) {
      await Message.findOneAndUpdate(
        { _id: claimed._id, status: "scheduled" },
        { $set: { status: "pending", inboxId: null, scheduledAt: null } },
      );
      return "none";
    }
    return "scheduled";
  }
  return "none";
}
