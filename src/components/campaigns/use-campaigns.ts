"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, apiFetchPage, errorMessage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  CampaignDTO,
  CampaignPreviewDTO,
  CampaignStatsDTO,
  CreateCampaignInput,
  MessageDTO,
  PreviewCampaignInput,
  StartCampaignResult,
  TestSendCampaignInput,
  UpdateCampaignInput,
} from "@/shared/campaign";
import type { TestSendResult } from "@/shared/inbox";
import type { CampaignReadinessDTO } from "@/shared/readiness";

/** Running campaigns refresh on their own (the worker changes their numbers). */
const LIVE_REFRESH_MS = 10_000;

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined || v === "" ? [] : [[k, String(v)]],
    ),
  ).toString();

function useInvalidateCampaigns() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all });
}

export function useCampaigns(params: {
  page: number;
  limit: number;
  status?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: queryKeys.campaigns.list(params),
    queryFn: () => apiFetchPage<CampaignDTO>(`/api/campaigns?${qs(params)}`),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.data.some((c) => c.status === "running") ? LIVE_REFRESH_MS : false,
  });
}

export function useCampaign(id: string | null) {
  return useQuery({
    queryKey: queryKeys.campaigns.detail(id ?? ""),
    queryFn: () => apiFetch<CampaignDTO>(`/api/campaigns/${id}`),
    enabled: !!id,
    refetchInterval: (query) => (query.state.data?.status === "running" ? LIVE_REFRESH_MS : false),
  });
}

export function useCampaignStats(id: string | null, live = false) {
  return useQuery({
    queryKey: queryKeys.campaigns.stats(id ?? ""),
    queryFn: () => apiFetch<CampaignStatsDTO>(`/api/campaigns/${id}/stats`),
    enabled: !!id,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

export function useCampaignMessages(
  id: string,
  params: { page: number; limit: number; status?: string; search?: string },
  live = false,
) {
  return useQuery({
    queryKey: queryKeys.campaigns.messages(id, params),
    queryFn: () => apiFetchPage<MessageDTO>(`/api/campaigns/${id}/messages?${qs(params)}`),
    placeholderData: keepPreviousData,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

/** Live preview: re-renders whenever the (debounced) input changes. Nothing is saved. */
export function useCampaignPreview(id: string | null, input: PreviewCampaignInput) {
  return useQuery({
    queryKey: queryKeys.campaigns.preview(id ?? "", input),
    queryFn: () =>
      apiFetch<CampaignPreviewDTO>(`/api/campaigns/${id}/preview`, { method: "POST", body: input }),
    enabled: !!id,
    placeholderData: keepPreviousData,
  });
}

/** Readiness facts from the database (columns, empty fields, inboxes, DNS, Mail.Read, test sent). */
export function useCampaignReadiness(id: string | null) {
  return useQuery({
    queryKey: queryKeys.campaigns.readiness(id ?? ""),
    queryFn: () => apiFetch<CampaignReadinessDTO>(`/api/campaigns/${id}/readiness`),
    enabled: !!id,
  });
}

/** "Send test to myself" (simulated while DRY_RUN=true). */
export function useTestSendCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: ({ id, ...input }: TestSendCampaignInput & { id: string }) =>
      apiFetch<TestSendResult>(`/api/campaigns/${id}/test-send`, { method: "POST", body: input }),
    onSuccess: (result) => {
      const format = result.format === "outlook" ? "Outlook format" : "MIME format";
      if (result.mode === "dry-run") {
        toast.success(`Test simulated (dry run, ${format}) — nothing was really sent.`);
      } else {
        toast.success(`Test sent to ${result.to} from ${result.from} (${format}).`, {
          description: "Check that inbox (and its spam folder) in a minute.",
        });
      }
      return invalidate();
    },
  });
}

export function useCreateCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (input: CreateCampaignInput) =>
      apiFetch<CampaignDTO>("/api/campaigns", { method: "POST", body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateCampaignInput & { id: string }) =>
      apiFetch<CampaignDTO>(`/api/campaigns/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useStartCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<StartCampaignResult>(`/api/campaigns/${id}/start`, { method: "POST" }),
    onSuccess: (result) => {
      toast.success(`"${result.campaign.name}" started`, {
        description: `${result.pending.toLocaleString()} email(s) queued, ${result.skipped.toLocaleString()} skipped.`,
      });
      return invalidate();
    },
  });
}

export function usePauseResumeCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" }) =>
      apiFetch<CampaignDTO>(`/api/campaigns/${id}/${action}`, { method: "POST" }),
    onSuccess: (campaign) => {
      toast.success(`"${campaign.name}" ${campaign.status === "paused" ? "paused" : "resumed"}`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteCampaign() {
  const invalidate = useInvalidateCampaigns();
  return useMutation({
    mutationFn: (campaign: Pick<CampaignDTO, "id" | "name">) =>
      apiFetch<{ id: string }>(`/api/campaigns/${campaign.id}`, { method: "DELETE" }),
    onSuccess: (_r, campaign) => {
      toast.success(`Deleted "${campaign.name}"`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
