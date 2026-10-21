import { z } from "zod";
import type { CampaignStatus, InboxStatus } from "./enums";

/** `GET /api/dashboard/timeline?days=14` */
export const timelineQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

export type SendingModeDTO = "dry-run" | "live" | "disabled";

export type DashboardSummaryDTO = {
  sentToday: number;
  sentThisWeek: number;
  totalSent: number;
  /** pending + scheduled */
  inQueue: number;
  failedToday: number;
  activeInboxes: number;
  nextEmail: { to: string; fromInbox: string; scheduledAt: string } | null;
  /** Why nothing is scheduled (null when something is, or when there is nothing to explain). */
  idleReason: string | null;
  dryRun: boolean;
  sendingEnabled: boolean;
  /** dry-run = fake sending, live = real sending, disabled = kill switch (nothing is sent) */
  mode: SendingModeDTO;
  workerRunning: boolean;
  timezone: string;
};

export type DashboardInboxDTO = {
  id: string;
  email: string;
  domain: string;
  status: InboxStatus;
  pauseReason: string | null;
  sentToday: number;
  dailyLimit: number;
  lastSentAt: string | null;
  nextScheduledAt: string | null;
};

export type TimelineDayDTO = { date: string; sent: number; failed: number };

export type ActivityDTO = {
  id: string;
  type: string;
  message: string;
  createdAt: string;
};

export type DashboardCampaignDTO = {
  id: string;
  name: string;
  status: CampaignStatus;
  sent: number;
  total: number;
  /** pending + scheduled + sending */
  remaining: number;
  failed: number;
  skipped: number;
  /** Estimated finish (ISO) or the completion date; null when it cannot finish. */
  eta: string | null;
  timezone: string;
};
