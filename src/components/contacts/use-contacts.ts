"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiFetch, apiFetchPage, apiUpload, errorMessage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type {
  ColumnMapping,
  ContactDTO,
  ImportPreview,
  ImportReport,
  UpdateContactInput,
} from "@/shared/contact";
import type { CreateListInput, ListDTO, UpdateListInput } from "@/shared/list";
import type {
  CreateSuppressionInput,
  SuppressionDTO,
  SuppressionImportReport,
} from "@/shared/suppression";

const qs = (params: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined || v === "" ? [] : [[k, String(v)]],
    ),
  ).toString();

/** Contacts, lists and suppressions all affect each other's counts/statuses → refresh all three. */
function useInvalidateContacts() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [queryKeys.contacts.all, queryKeys.lists.all, queryKeys.suppressions.all].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

// ---------- contacts ----------

export function useContacts(params: {
  page: number;
  limit: number;
  search?: string;
  listId?: string;
  status?: string;
}) {
  return useQuery({
    queryKey: queryKeys.contacts.list(params),
    queryFn: () => apiFetchPage<ContactDTO>(`/api/contacts?${qs(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useUpdateContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateContactInput & { id: string }) =>
      apiFetch<ContactDTO>(`/api/contacts/${id}`, { method: "PATCH", body: input }),
    onSuccess: (contact) => {
      toast.success(`${contact.email} saved`);
      return invalidate();
    },
  });
}

export function useDeleteContact() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (contact: Pick<ContactDTO, "id" | "email">) =>
      apiFetch<{ id: string }>(`/api/contacts/${contact.id}`, { method: "DELETE" }),
    onSuccess: (_r, contact) => {
      toast.success(`Deleted ${contact.email}`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useImportPreview() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return apiUpload<ImportPreview>("/api/contacts/import/preview", form);
    },
  });
}

export function useImportConfirm() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (input: { file: File; mapping: ColumnMapping; listId: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      form.set("mapping", JSON.stringify(input.mapping));
      form.set("listId", input.listId);
      return apiUpload<ImportReport>("/api/contacts/import/confirm", form);
    },
    onSuccess: () => invalidate(),
  });
}

// ---------- lists ----------

export function useLists(params = { page: 1, limit: 100 }) {
  return useQuery({
    queryKey: queryKeys.lists.list(params),
    queryFn: () => apiFetchPage<ListDTO>(`/api/lists?${qs(params)}`),
  });
}

export function useCreateList() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (input: CreateListInput) =>
      apiFetch<ListDTO>("/api/lists", { method: "POST", body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateList() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateListInput & { id: string }) =>
      apiFetch<ListDTO>(`/api/lists/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteList() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (list: Pick<ListDTO, "id" | "name">) =>
      apiFetch<{ id: string }>(`/api/lists/${list.id}`, { method: "DELETE" }),
    onSuccess: (_r, list) => {
      toast.success(`Deleted list "${list.name}"`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

// ---------- suppressions ----------

export function useSuppressions(params: { page: number; limit: number; search?: string }) {
  return useQuery({
    queryKey: queryKeys.suppressions.list(params),
    queryFn: () => apiFetchPage<SuppressionDTO>(`/api/suppressions?${qs(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useCreateSuppression() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (input: CreateSuppressionInput) =>
      apiFetch<SuppressionDTO>("/api/suppressions", { method: "POST", body: input }),
    onSuccess: (s) => {
      toast.success(`${s.email} will never be emailed`);
      return invalidate();
    },
  });
}

export function useDeleteSuppression() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (s: Pick<SuppressionDTO, "id" | "email">) =>
      apiFetch<{ id: string }>(`/api/suppressions/${s.id}`, { method: "DELETE" }),
    onSuccess: (_r, s) => {
      toast.success(`${s.email} removed from the suppression list`);
      return invalidate();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}

export function useImportSuppressions() {
  const invalidate = useInvalidateContacts();
  return useMutation({
    mutationFn: (input: { file: File; reason: string; note: string }) => {
      const form = new FormData();
      form.set("file", input.file);
      form.set("reason", input.reason);
      form.set("note", input.note);
      return apiUpload<SuppressionImportReport>("/api/suppressions/import", form);
    },
    onSuccess: () => invalidate(),
  });
}
