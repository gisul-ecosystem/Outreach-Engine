// Dashboard numbers (BUILD_PLAN section 9). Every query is a count / small aggregation that uses an index:
//   messages { status, sentAt }       → sent today / this week / total, per-inbox sent today, timeline
//   messages { status, scheduledAt }  → queue size, next email, next send per inbox
//   messages { campaignId, status }   → campaign progress
//   events   { createdAt }            → activity feed
import { DateTime } from "luxon";
import type { Types } from "mongoose";
import { connectDB } from "@/server/db/connect";
import { Campaign, Domain, Event, Inbox, Message } from "@/server/db/models";
import { notDeleted } from "@/server/db/soft-delete";
import { sendingMode } from "@/server/providers";
import { isInsideWindow, nextWindowStart, startOfDayInTz } from "@/server/scheduler/time";
import { getCampaignStats } from "@/server/services/campaign.service";
import { getTimezone } from "@/server/services/settings.service";
import { isWorkerRunning } from "@/server/services/worker.service";
import { getEnv } from "@/server/config/env";
import type {
  ActivityDTO,
  DashboardCampaignDTO,
  DashboardInboxDTO,
  DashboardSummaryDTO,
  TimelineDayDTO,
} from "@/shared/dashboard";
import type { InboxStatus } from "@/shared/enums";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const MAX_CAMPAIGN_CARDS = 8;

export async function getDashboardSummary(now = new Date()): Promise<DashboardSummaryDTO> {
  await connectDB();
  const env = getEnv();
  const tz = await getTimezone();
  const dayStart = startOfDayInTz(now, tz);
  const weekStart = DateTime.fromJSDate(now, { zone: tz }).startOf("week").toJSDate(); // Monday 00:00

  const [
    sentToday,
    sentThisWeek,
    totalSent,
    inQueue,
    failedToday,
    activeInboxes,
    next,
    workerRunning,
  ] = await Promise.all([
    Message.countDocuments({ status: "sent", sentAt: { $gte: dayStart } }),
    Message.countDocuments({ status: "sent", sentAt: { $gte: weekStart } }),
    Message.countDocuments({ status: "sent" }),
    Message.countDocuments({ status: { $in: ["pending", "scheduled"] } }),
    // A failed message is not touched again, so updatedAt is the moment it failed.
    Message.countDocuments({ status: "failed", updatedAt: { $gte: dayStart } }),
    Inbox.countDocuments(notDeleted({ status: "active" })),
    Message.findOne({ status: "scheduled" })
      .sort({ scheduledAt: 1 })
      .select("toEmail inboxId scheduledAt")
      .lean(),
    isWorkerRunning(now),
  ]);

  let nextEmail: DashboardSummaryDTO["nextEmail"] = null;
  if (next?.scheduledAt) {
    const inbox = next.inboxId ? await Inbox.findById(next.inboxId).select("email").lean() : null;
    nextEmail = {
      to: next.toEmail,
      fromInbox: inbox?.email ?? "—",
      scheduledAt: next.scheduledAt.toISOString(),
    };
  }

  const idleReason = nextEmail ? null : await explainIdle(now, tz);
  const autoPaused = await Campaign.find(
    notDeleted({ status: "paused", pauseReason: { $nin: [null, ""] } }),
  )
    .select("name pauseReason")
    .lean();

  return {
    sentToday,
    sentThisWeek,
    totalSent,
    inQueue,
    failedToday,
    activeInboxes,
    nextEmail,
    idleReason,
    dryRun: env.DRY_RUN,
    sendingEnabled: env.SENDING_ENABLED,
    mode: sendingMode(),
    workerRunning,
    timezone: tz,
    alerts: autoPaused.map((c) => ({
      campaignId: String(c._id),
      campaignName: c.name,
      reason: c.pauseReason ?? "",
    })),
  };
}

/** Plain-English reason why no email is scheduled right now. */
async function explainIdle(now: Date, tz: string): Promise<string | null> {
  const campaigns = await Campaign.find({ status: "running", deletedAt: null })
    .select("sendWindow")
    .lean();
  if (campaigns.length === 0) return "No campaign is running. Start or resume a campaign.";
  const pending = await Message.countDocuments({
    status: "pending",
    campaignId: { $in: campaigns.map((c) => c._id) },
  });
  if (pending === 0) return null;

  const windows = campaigns.map((c) => ({
    startMinute: c.sendWindow?.startMinute ?? 0,
    endMinute: c.sendWindow?.endMinute ?? 0,
    days: [...(c.sendWindow?.days ?? [])],
  }));
  if (!windows.some((w) => isInsideWindow(now, w, tz))) {
    const opens = windows
      .map((w) => nextWindowStart(now, w, tz))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return opens
      ? `Outside the sending window. Sending resumes ${DateTime.fromJSDate(opens, { zone: tz }).toFormat("ccc d LLL, h:mm a")} (${tz}).`
      : "Outside the sending window.";
  }
  return "Waiting for an inbox to be free (gap between emails, daily limit, or inbox paused). The planner checks every 30 seconds.";
}

export async function getDashboardInboxes(now = new Date()): Promise<DashboardInboxDTO[]> {
  await connectDB();
  const tz = await getTimezone();
  const dayStart = startOfDayInTz(now, tz);

  const [inboxes, sentRows, nextRows] = await Promise.all([
    Inbox.find(notDeleted({})).sort({ email: 1 }).lean(),
    Message.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { status: "sent", sentAt: { $gte: dayStart } } },
      { $group: { _id: "$inboxId", n: { $sum: 1 } } },
    ]),
    Message.aggregate<{ _id: Types.ObjectId; at: Date }>([
      { $match: { status: "scheduled" } },
      { $group: { _id: "$inboxId", at: { $min: "$scheduledAt" } } },
    ]),
  ]);
  const domains = await Domain.find({ _id: { $in: inboxes.map((i) => i.domainId) } })
    .select("name")
    .lean();
  const domainName = new Map(domains.map((d) => [String(d._id), d.name]));
  const sentBy = new Map(sentRows.map((r) => [String(r._id), r.n]));
  const nextBy = new Map(nextRows.map((r) => [String(r._id), r.at]));

  return inboxes.map((inbox) => ({
    id: String(inbox._id),
    email: inbox.email,
    domain: domainName.get(String(inbox.domainId)) ?? "—",
    status: inbox.status as InboxStatus,
    pauseReason: inbox.pauseReason ?? null,
    sentToday: sentBy.get(String(inbox._id)) ?? 0,
    dailyLimit: inbox.dailyLimit,
    lastSentAt: iso(inbox.lastSentAt),
    nextScheduledAt: iso(nextBy.get(String(inbox._id))),
  }));
}

/** Sent and failed emails per day in the app timezone; days without any are included with 0. */
export async function getDashboardTimeline(days = 14, now = new Date()): Promise<TimelineDayDTO[]> {
  await connectDB();
  const tz = await getTimezone();
  const today = DateTime.fromJSDate(now, { zone: tz }).startOf("day");
  const first = today.minus({ days: days - 1 });
  const from = first.toJSDate();

  const perDay = (status: "sent" | "failed", field: "sentAt" | "updatedAt") =>
    Message.aggregate<{ _id: string; n: number }>([
      { $match: { status, [field]: { $gte: from } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: `$${field}`, timezone: tz } },
          n: { $sum: 1 },
        },
      },
    ]);
  const [sent, failed] = await Promise.all([
    perDay("sent", "sentAt"),
    perDay("failed", "updatedAt"),
  ]);
  const sentBy = new Map(sent.map((r) => [r._id, r.n]));
  const failedBy = new Map(failed.map((r) => [r._id, r.n]));

  return Array.from({ length: days }, (_, i) => {
    const date = first.plus({ days: i }).toFormat("yyyy-MM-dd");
    return { date, sent: sentBy.get(date) ?? 0, failed: failedBy.get(date) ?? 0 };
  });
}

export async function getDashboardActivity(limit = 20): Promise<ActivityDTO[]> {
  await connectDB();
  const events = await Event.find().sort({ createdAt: -1 }).limit(limit).lean();
  return events.map((e) => ({
    id: String(e._id),
    type: e.type,
    message: e.message ?? "",
    createdAt: (e as unknown as { createdAt: Date }).createdAt.toISOString(),
  }));
}

/** Running and paused campaigns first, then the most recently completed ones. */
export async function getDashboardCampaigns(now = new Date()): Promise<DashboardCampaignDTO[]> {
  await connectDB();
  const campaigns = await Campaign.find(
    notDeleted({ status: { $in: ["running", "paused", "completed"] } }),
  )
    .select("name status updatedAt")
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();
  const rank = { running: 0, paused: 1, completed: 2, draft: 3 } as const;
  const shown = campaigns
    .sort((a, b) => rank[a.status] - rank[b.status])
    .slice(0, MAX_CAMPAIGN_CARDS);

  return Promise.all(
    shown.map(async (campaign) => {
      const stats = await getCampaignStats(String(campaign._id), now);
      return {
        id: String(campaign._id),
        name: campaign.name,
        status: stats.status,
        sent: stats.counts.sent,
        total: stats.totalMessages - stats.counts.skipped,
        remaining: stats.remaining,
        failed: stats.counts.failed,
        skipped: stats.counts.skipped,
        eta: stats.eta,
        timezone: stats.timezone,
      };
    }),
  );
}
