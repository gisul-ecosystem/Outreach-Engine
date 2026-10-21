"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, apiFetchPage, errorMessage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  CreateInboxInput,
  DiscoverMailboxesResult,
  ImportInboxesInput,
  ImportInboxesResult,
  InboxDTO,
  TestSendResult,
  UpdateInboxInput,
} from "@/shared/inbox";

export function useInboxes(params: { page: number; limit: number; domainId?: string }) {
  const qs = new URLSearchParams({ page: String(params.page), limit: String(params.limit) });
  if (params.domainId) qs.set("domainId", params.domainId);
  return useQuery({
    queryKey: queryKeys.inboxes.list(params),
    queryFn: () => apiFetchPage<InboxDTO>(`/api/inboxes?${qs}`),
    placeholderData: keepPreviousData,
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  // Inbox counts appear on the Domains and Providers pages too.
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inboxes.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.domains.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.providers.all }),
    ]);
}

export function useCreateInbox() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateInboxInput) =>
      apiFetch<InboxDTO>("/api/inboxes", { method: "POST", body: input }),
    onSuccess: (inbox) => {
      toast.success(`${inbox.email} added`);
      return invalidate();
    },
  });
}

export function useUpdateInbox() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateInboxInput & { id: string }) =>
      apiFetch<InboxDTO>(`/api/inboxes/${id}`, { method: "PATCH", body: input }),
    onSuccess: (inbox) => {
      toast.success(`${inbox.email} saved`);
      return invalidate();
    },
  });
}

export function usePauseResumeInbox() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ inbox, action }: { inbox: Pick<InboxDTO, "id">; action: "pause" | "resume" }) =>
      apiFetch<InboxDTO>(`/api/inboxes/${inbox.id}/${action}`, { method: "POST" }),
    onSuccess: (inbox) => {
      toast.success(`${inbox.email} ${inbox.status === "active" ? "resumed" : "paused"}`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useDeleteInbox() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (inbox: Pick<InboxDTO, "id" | "email">) =>
      apiFetch<{ id: string }>(`/api/inboxes/${inbox.id}`, { method: "DELETE" }),
    onSuccess: (_r, inbox) => {
      toast.success(`Deleted ${inbox.email}`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useTestSend() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ inbox, to }: { inbox: Pick<InboxDTO, "id">; to: string }) =>
      apiFetch<TestSendResult>(`/api/inboxes/${inbox.id}/test-send`, {
        method: "POST",
        body: { to },
      }),
    onSuccess: (result) => {
      if (result.mode === "dry-run") {
        toast.success(`Dry run: test email to ${result.to} was simulated (not really sent).`, {
          description: "Set DRY_RUN=false and SENDING_ENABLED=true in .env.local to send for real.",
        });
      } else {
        toast.success(`Test email sent from ${result.from} to ${result.to}. Check that inbox.`);
      }
      return invalidate();
    },
  });
}

export function useDiscoverMailboxes(
  domainId: string | null,
  providerConnectionId: string | null,
  enabled: boolean,
) {
  const qs = providerConnectionId ? `?providerConnectionId=${providerConnectionId}` : "";
  return useQuery({
    queryKey: ["domains", "mailboxes", domainId, providerConnectionId],
    queryFn: () => apiFetch<DiscoverMailboxesResult>(`/api/domains/${domainId}/mailboxes${qs}`),
    enabled: enabled && !!domainId,
    staleTime: 0,
    retry: false,
  });
}

export function useImportInboxes() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ domainId, ...input }: ImportInboxesInput & { domainId: string }) =>
      apiFetch<ImportInboxesResult>(`/api/domains/${domainId}/mailboxes/import`, {
        method: "POST",
        body: input,
      }),
    onSuccess: (result) => {
      toast.success(
        `${result.imported.length} inbox${result.imported.length === 1 ? "" : "es"} added`,
        {
          description: result.skipped.length
            ? `${result.skipped.length} skipped: ${result.skipped.map((s) => `${s.email} — ${s.reason}`).join("; ")}`
            : "They are ready to use in campaigns.",
        },
      );
      return invalidate();
    },
  });
}
