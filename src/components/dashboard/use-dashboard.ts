"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  ActivityDTO,
  DashboardCampaignDTO,
  DashboardInboxDTO,
  DashboardSummaryDTO,
  TimelineDayDTO,
} from "@/shared/dashboard";

/** The dashboard refreshes itself every 10 seconds (countdowns tick in the browser in between). */
const REFRESH_MS = 10_000;
const live = { refetchInterval: REFRESH_MS, refetchIntervalInBackground: false } as const;

export const useDashboardSummary = () =>
  useQuery({
    queryKey: queryKeys.dashboard.summary,
    queryFn: () => apiFetch<DashboardSummaryDTO>("/api/dashboard/summary"),
    ...live,
  });

export const useDashboardInboxes = () =>
  useQuery({
    queryKey: queryKeys.dashboard.inboxes,
    queryFn: () => apiFetch<DashboardInboxDTO[]>("/api/dashboard/inboxes"),
    ...live,
  });

export const useDashboardCampaigns = () =>
  useQuery({
    queryKey: queryKeys.dashboard.campaigns,
    queryFn: () => apiFetch<DashboardCampaignDTO[]>("/api/dashboard/campaigns"),
    ...live,
  });

export const useDashboardTimeline = (days = 14) =>
  useQuery({
    queryKey: queryKeys.dashboard.timeline(days),
    queryFn: () => apiFetch<TimelineDayDTO[]>(`/api/dashboard/timeline?days=${days}`),
    ...live,
  });

export const useDashboardActivity = () =>
  useQuery({
    queryKey: queryKeys.dashboard.activity,
    queryFn: () => apiFetch<ActivityDTO[]>("/api/dashboard/activity"),
    ...live,
  });
