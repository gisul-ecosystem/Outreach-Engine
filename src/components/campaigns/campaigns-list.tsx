"use client";

import {
  EyeIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SimpleSelect } from "@/components/common/simple-select";
import { EmptyState } from "@/components/layout/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { errorMessage } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import type { CampaignDTO } from "@/shared/campaign";
import { CAMPAIGN_STATUSES } from "@/shared/enums";
import { CampaignStatusBadge, ProgressBar } from "./campaign-status-badge";
import { DeleteCampaignDialog } from "./delete-campaign-dialog";
import { useCampaigns, usePauseResumeCampaign } from "./use-campaigns";

const PAGE_SIZE = 20;
const ALL = "all";
const STATUS_OPTIONS = [
  { value: ALL, label: "All statuses" },
  ...CAMPAIGN_STATUSES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
];

/** Sent out of everything that will be sent (skipped messages are not counted). */
export function campaignProgress(c: Pick<CampaignDTO, "counts" | "totalMessages">) {
  const target = c.totalMessages - c.counts.skipped;
  return { done: c.counts.sent, target };
}

export function CampaignsList() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [toDelete, setToDelete] = useState<CampaignDTO | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());

  const campaigns = useCampaigns({
    page,
    limit: PAGE_SIZE,
    search: debouncedSearch || undefined,
    status: status === ALL ? undefined : status,
  });
  const pauseResume = usePauseResumeCampaign();

  const total = campaigns.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = !!debouncedSearch || status !== ALL;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search campaigns"
              className="w-60 pl-8"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <SimpleSelect
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={STATUS_OPTIONS}
            className="w-40"
          />
        </div>
        <Link href="/campaigns/new" className={buttonVariants()}>
          <PlusIcon />
          New campaign
        </Link>
      </div>

      {campaigns.isError ? (
        <div className="rounded-lg border border-destructive/30 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load campaigns</p>
          <p className="mt-1 text-muted-foreground">{errorMessage(campaigns.error)}</p>
        </div>
      ) : campaigns.data && campaigns.data.data.length === 0 && page === 1 ? (
        <EmptyState
          icon={SendIcon}
          title={filtered ? "No matching campaigns" : "No campaigns yet"}
          description={
            filtered
              ? "Try another search or status."
              : "Create a campaign: pick a list and inboxes, write the email, choose the sending hours and start."
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-56">Progress</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : campaigns.data?.data.map((c) => {
                    const { done, target } = campaignProgress(c);
                    const editable = c.status === "draft" || c.status === "paused";
                    return (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Link
                            href={
                              c.status === "draft"
                                ? `/campaigns/${c.id}/edit`
                                : `/campaigns/${c.id}`
                            }
                            className="font-medium hover:underline"
                          >
                            {c.name}
                          </Link>
                          <span className="block text-xs text-muted-foreground">
                            {c.listName ?? "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <CampaignStatusBadge status={c.status} />
                        </TableCell>
                        <TableCell>
                          {c.status === "draft" ? (
                            <span className="text-sm text-muted-foreground">Not started</span>
                          ) : (
                            <div className="grid gap-1">
                              <ProgressBar value={done} max={target} />
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {done.toLocaleString()} / {target.toLocaleString()} sent
                                {c.counts.failed > 0 && ` · ${c.counts.failed} failed`}
                              </span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(c.createdAt)}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={<Button variant="ghost" size="icon-sm" />}
                              aria-label={`Actions for ${c.name}`}
                            >
                              <MoreHorizontalIcon />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => router.push(`/campaigns/${c.id}`)}>
                                <EyeIcon />
                                Open
                              </DropdownMenuItem>
                              {editable && (
                                <DropdownMenuItem
                                  onClick={() => router.push(`/campaigns/${c.id}/edit`)}
                                >
                                  <PencilIcon />
                                  {c.status === "draft" ? "Continue setup" : "Edit"}
                                </DropdownMenuItem>
                              )}
                              {c.status === "running" && (
                                <DropdownMenuItem
                                  onClick={() => pauseResume.mutate({ id: c.id, action: "pause" })}
                                >
                                  <PauseIcon />
                                  Pause
                                </DropdownMenuItem>
                              )}
                              {c.status === "paused" && (
                                <DropdownMenuItem
                                  onClick={() => pauseResume.mutate({ id: c.id, action: "resume" })}
                                >
                                  <PlayIcon />
                                  Resume
                                </DropdownMenuItem>
                              )}
                              {c.status !== "running" && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    variant="destructive"
                                    onClick={() => setToDelete(c)}
                                  >
                                    <Trash2Icon />
                                    Delete
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <DeleteCampaignDialog campaign={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}
