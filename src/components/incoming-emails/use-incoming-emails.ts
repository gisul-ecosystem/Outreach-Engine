"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiFetch, apiFetchPage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  IncomingEmailDTO,
  IncomingEmailDetailDTO,
  IncomingEmailsPageDTO,
  IncomingKindFilter,
} from "@/shared/incoming-email";

/** The worker reads each Inbox folder every 5 minutes; refreshing every 30 seconds is plenty. */
const live = {
  refetchInterval: 30_000,
  refetchIntervalInBackground: false,
} as const;

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined || v === "" ? [] : [[k, String(v)]],
    ),
  ).toString();

export function useIncomingEmails(params: {
  page: number;
  limit: number;
  kind: IncomingKindFilter;
  inboxId?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: queryKeys.incomingEmails.list(params),
    queryFn: () =>
      apiFetchPage<IncomingEmailDTO>(
        `/api/incoming-emails?${qs(params)}`,
      ) as Promise<IncomingEmailsPageDTO>,
    placeholderData: keepPreviousData,
    ...live,
  });
}

export function useIncomingEmail(id: string | null) {
  return useQuery({
    queryKey: queryKeys.incomingEmails.detail(id ?? ""),
    queryFn: () => apiFetch<IncomingEmailDetailDTO>(`/api/incoming-emails/${id}`),
    enabled: !!id,
  });
}
