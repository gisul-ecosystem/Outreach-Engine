import { z } from "zod";
import type { CampaignStatus, InboxStatus } from "./enums";

/** `GET /api/dashboard/timeline?days=14` */
export const timelineQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(14),
});

/** `GET /api/dashboard/clickers?period=week&limit=10` — clicks per person. */
export const clickersQuerySchema = z.object({
  /** week = since Monday 00:00 (app timezone); all = every click kept (one year). */
  period: z.enum(["week", "all"]).default("week"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ClickersPeriod = z.infer<typeof clickersQuerySchema>["period"];

/** One person and how often they opened their tracking links. */
export type DashboardClickerDTO = {
  contactId: string;
  email: string;
  name: string;
  company: string;
  /** Opens judged to be a real person. */
  realClicks: number;
  /** Opens by security scanners / bots, and "maybe a bot". */
  botOpens: number;
  /** Last real click (null when only bots opened it). */
  lastRealClickAt: string | null;
  /** Last open of any kind. */
  lastOpenAt: string;
};

export type SendingModeDTO = "dry-run" | "live" | "disabled";

export type DashboardSummaryDTO = {
  sentToday: number;
  sentThisWeek: number;
  totalSent: number;
  /** pending + scheduled */
  inQueue: number;
  failedToday: number;
  activeInboxes: number;
  /** Tracking-link clicks judged to be a real person, since Monday 00:00 (app timezone). */
  realClicksThisWeek: number;
  nextEmail: { to: string; fromInbox: string; scheduledAt: string } | null;
  /** Why nothing is scheduled (null when something is, or when there is nothing to explain). */
  idleReason: string | null;
  dryRun: boolean;
  sendingEnabled: boolean;
  /** dry-run = fake sending, live = real sending, disabled = kill switch (nothing is sent) */
  mode: SendingModeDTO;
  workerRunning: boolean;
  timezone: string;
  /** Campaigns the engine paused by itself (stop-on-error) — shown as red alerts. */
  alerts: { campaignId: string; campaignName: string; reason: string }[];
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
