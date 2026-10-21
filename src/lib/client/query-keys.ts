// All TanStack Query keys in one place, so refreshing ("invalidating") data uses the same keys everywhere.
type ListParams = { page: number; limit: number };

export const queryKeys = {
  dashboard: {
    all: ["dashboard"] as const,
    summary: ["dashboard", "summary"] as const,
    inboxes: ["dashboard", "inboxes"] as const,
    campaigns: ["dashboard", "campaigns"] as const,
    timeline: (days: number) => ["dashboard", "timeline", days] as const,
    activity: ["dashboard", "activity"] as const,
  },
  auth: {
    me: ["auth", "me"] as const,
  },
  domains: {
    all: ["domains"] as const,
    list: (params: ListParams) => ["domains", "list", params] as const,
    detail: (id: string) => ["domains", "detail", id] as const,
  },
  providers: {
    all: ["providers"] as const,
    list: (params: ListParams) => ["providers", "list", params] as const,
  },
  inboxes: {
    all: ["inboxes"] as const,
    list: (params: ListParams & { domainId?: string }) => ["inboxes", "list", params] as const,
  },
  lists: {
    all: ["lists"] as const,
    list: (params: ListParams) => ["lists", "list", params] as const,
  },
  contacts: {
    all: ["contacts"] as const,
    list: (params: ListParams & { search?: string; listId?: string; status?: string }) =>
      ["contacts", "list", params] as const,
  },
  suppressions: {
    all: ["suppressions"] as const,
    list: (params: ListParams & { search?: string }) => ["suppressions", "list", params] as const,
  },
  campaigns: {
    all: ["campaigns"] as const,
    list: (params: ListParams & { status?: string; search?: string }) =>
      ["campaigns", "list", params] as const,
    detail: (id: string) => ["campaigns", "detail", id] as const,
    stats: (id: string) => ["campaigns", "stats", id] as const,
    messages: (id: string, params: ListParams & { status?: string; search?: string }) =>
      ["campaigns", "messages", id, params] as const,
    preview: (id: string, input: object) => ["campaigns", "preview", id, input] as const,
  },
};
