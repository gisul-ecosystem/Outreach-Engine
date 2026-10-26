"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch, apiFetchPage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  TrackedEmailDTO,
  TrackedSourceFilter,
  TrackedStatsDTO,
  TrackingPeriod,
} from "@/shared/tracked-email";

/** The worker reads Sent Items every 5 minutes; refreshing every 30 seconds is plenty. */
const live = { refetchInterval: 30_000, refetchIntervalInBackground: false } as const;

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined || v === "" ? [] : [[k, String(v)]],
    ),
  ).toString();

export function useTrackedStats(params: {
  period: TrackingPeriod;
  count: number;
  source: TrackedSourceFilter;
  inboxId?: string;
}) {
  return useQuery({
    queryKey: queryKeys.sentEmails.stats(params),
    queryFn: () => apiFetch<TrackedStatsDTO>(`/api/sent-emails/stats?${qs(params)}`),
    placeholderData: keepPreviousData,
    ...live,
  });
}

export function useTrackedEmails(params: {
  page: number;
  limit: number;
  source: TrackedSourceFilter;
  inboxId?: string;
  search?: string;
  from?: string;
  to?: string;
  wrongLinksOnly?: "true";
}) {
  return useQuery({
    queryKey: queryKeys.sentEmails.list(params),
    queryFn: () => apiFetchPage<TrackedEmailDTO>(`/api/sent-emails?${qs(params)}`),
    placeholderData: keepPreviousData,
    ...live,
  });
}
