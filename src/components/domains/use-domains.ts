"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, apiFetchPage, errorMessage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type { CreateDomainInput, DomainDTO, UpdateDomainInput } from "@/shared/domain";

export function useDomains(params: { page: number; limit: number }) {
  return useQuery({
    queryKey: queryKeys.domains.list(params),
    queryFn: () =>
      apiFetchPage<DomainDTO>(`/api/domains?page=${params.page}&limit=${params.limit}`),
    placeholderData: keepPreviousData, // keep showing the old page while the next one loads
  });
}

function useInvalidateDomains() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.domains.all });
}

export function useCreateDomain() {
  const invalidate = useInvalidateDomains();
  return useMutation({
    mutationFn: (input: CreateDomainInput) =>
      apiFetch<DomainDTO>("/api/domains", { method: "POST", body: input }),
    onSuccess: (domain) => {
      toast.success(`${domain.name} added. DNS checked.`);
      return invalidate();
    },
  });
}

export function useUpdateDomain() {
  const invalidate = useInvalidateDomains();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateDomainInput & { id: string }) =>
      apiFetch<DomainDTO>(`/api/domains/${id}`, { method: "PATCH", body: input }),
    onSuccess: (domain) => {
      toast.success(`${domain.name} is now ${domain.status === "active" ? "active" : "paused"}`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

/** Sets (or removes, with "") the tracking address used for links in emails from this domain. */
export function useSetTrackingHost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, trackingHost }: { id: string; trackingHost: string }) =>
      apiFetch<DomainDTO>(`/api/domains/${id}`, { method: "PATCH", body: { trackingHost } }),
    onSuccess: (domain) => {
      toast.success(
        domain.trackingHost
          ? `Links for ${domain.name} now use ${domain.trackingHost}`
          : `Tracking address of ${domain.name} removed`,
      );
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.domains.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tracking.config }),
      ]);
    },
  });
}

export function useDeleteDomain() {
  const invalidate = useInvalidateDomains();
  return useMutation({
    mutationFn: (domain: Pick<DomainDTO, "id" | "name">) =>
      apiFetch<{ id: string; deletedInboxes: number }>(`/api/domains/${domain.id}`, {
        method: "DELETE",
      }),
    onSuccess: (result, domain) => {
      const inboxes = result.deletedInboxes
        ? ` and ${result.deletedInboxes} inbox${result.deletedInboxes === 1 ? "" : "es"}`
        : "";
      toast.success(`Deleted ${domain.name}${inboxes}`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useCheckDns() {
  const invalidate = useInvalidateDomains();
  return useMutation({
    mutationFn: (domain: Pick<DomainDTO, "id" | "name">) =>
      apiFetch<DomainDTO>(`/api/domains/${domain.id}/check-dns`, { method: "POST" }),
    onSuccess: (domain) => {
      toast.success(`DNS re-checked for ${domain.name}`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
