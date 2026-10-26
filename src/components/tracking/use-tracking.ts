"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchPage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  ClickFilter,
  CreateLinkInput,
  LinkClickDTO,
  TimelineItemDTO,
  TrackedLinkDTO,
  TrackingConfigDTO,
} from "@/shared/tracking";

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined || v === "" ? [] : [[k, String(v)]],
    ),
  ).toString();

export const useTrackingConfig = () =>
  useQuery({
    queryKey: queryKeys.tracking.config,
    queryFn: () => apiFetch<TrackingConfigDTO>("/api/tracking/config"),
    staleTime: 5 * 60_000,
  });

export const useContactLinks = (contactId: string | null) =>
  useQuery({
    queryKey: queryKeys.tracking.links(contactId ?? ""),
    queryFn: () => apiFetch<TrackedLinkDTO[]>(`/api/contacts/${contactId}/links`),
    enabled: !!contactId,
  });

export const useContactTimeline = (contactId: string | null) =>
  useQuery({
    queryKey: queryKeys.tracking.timeline(contactId ?? ""),
    queryFn: () => apiFetch<TimelineItemDTO[]>(`/api/contacts/${contactId}/timeline`),
    enabled: !!contactId,
    refetchInterval: 30_000,
  });

export function useCreateLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, ...input }: CreateLinkInput & { contactId: string }) =>
      apiFetch<TrackedLinkDTO>(`/api/contacts/${contactId}/links`, { method: "POST", body: input }),
    onSuccess: (_link, { contactId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.tracking.links(contactId) }),
  });
}

export function useClicks(params: {
  page: number;
  limit: number;
  include: ClickFilter;
  inboxId?: string;
  from?: string;
  to?: string;
}) {
  return useQuery({
    queryKey: queryKeys.tracking.clicks(params),
    queryFn: () => apiFetchPage<LinkClickDTO>(`/api/tracking/clicks?${qs(params)}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}
