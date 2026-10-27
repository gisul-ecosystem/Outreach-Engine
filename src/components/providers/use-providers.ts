"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, apiFetchPage, errorMessage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import {
  PROVIDER_TYPE_LABELS,
  type CreateProviderInput,
  type CreateZeptoProviderInput,
  type ProviderDTO,
  type UpdateProviderInput,
} from "@/shared/provider";

export function useProviders(params = { page: 1, limit: 100 }) {
  return useQuery({
    queryKey: queryKeys.providers.list(params),
    queryFn: () =>
      apiFetchPage<ProviderDTO>(`/api/providers?page=${params.page}&limit=${params.limit}`),
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxes.all }),
    ]);
}

export function useCreateProvider() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateProviderInput | CreateZeptoProviderInput) =>
      apiFetch<ProviderDTO>("/api/providers", { method: "POST", body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateProvider() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateProviderInput & { id: string }) =>
      apiFetch<ProviderDTO>(`/api/providers/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useVerifyProvider() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (provider: Pick<ProviderDTO, "id">) =>
      apiFetch<ProviderDTO>(`/api/providers/${provider.id}/verify`, { method: "POST" }),
    onSuccess: (provider) => {
      if (provider.status === "connected")
        toast.success(`${provider.name}: connected to ${PROVIDER_TYPE_LABELS[provider.type]}`);
      else toast.error(`${provider.name}: ${provider.lastError ?? "verification failed"}`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteProvider() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (provider: Pick<ProviderDTO, "id" | "name">) =>
      apiFetch<{ id: string; pausedInboxes: number }>(`/api/providers/${provider.id}`, {
        method: "DELETE",
      }),
    onSuccess: (result, provider) => {
      toast.success(
        result.pausedInboxes
          ? `Deleted ${provider.name}. ${result.pausedInboxes} inbox(es) paused — edit them to choose a new provider.`
          : `Deleted ${provider.name}`,
      );
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
