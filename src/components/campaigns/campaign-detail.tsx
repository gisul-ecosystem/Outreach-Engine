"use client";

import {
  ArrowLeftIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SimpleSelect } from "@/components/common/simple-select";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/client/api";
import { formatDateTime, formatDayInZone } from "@/lib/client/format";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import { MESSAGE_STATUSES } from "@/shared/enums";
import {
  CampaignStatusBadge,
  MESSAGE_STATUS_LABELS,
  MessageStatusBadge,
  ProgressBar,
} from "./campaign-status-badge";
import { DeleteCampaignDialog } from "./delete-campaign-dialog";
import {
  useCampaign,
  useCampaignMessages,
  useCampaignStats,
  usePauseResumeCampaign,
} from "./use-campaigns";
import { describeWindow } from "./wizard-form";

const PAGE_SIZE = 25;
const ALL = "all";
const STATUS_OPTIONS = [
  { value: ALL, label: "All messages" },
  ...MESSAGE_STATUSES.map((s) => ({ value: s, label: MESSAGE_STATUS_LABELS[s] })),
];

export function CampaignDetail({ id }: { id: string }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(ALL);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim());

  const campaign = useCampaign(id);
  const live = campaign.data?.status === "running";
  const stats = useCampaignStats(id, live);
  const messages = useCampaignMessages(
    id,
    {
      page,
      limit: PAGE_SIZE,
      status: status === ALL ? undefined : status,
      search: debouncedSearch || undefined,
    },
    live,
  );
  const pauseResume = usePauseResumeCampaign();

  if (campaign.isError) {
    return (
      <div className="rounded-lg border border-destructive/30 p-6 text-sm">
        <p className="font-medium text-destructive">Could not load this campaign</p>
        <p className="mt-1 text-muted-foreground">{errorMessage(campaign.error)}</p>
        <Link
          href="/campaigns"
          className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}
        >
          Back to campaigns
        </Link>
      </div>
    );
  }
  if (!campaign.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const c = campaign.data;
  const s = stats.data;
  const target = c.totalMessages - c.counts.skipped;
  const total = messages.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const editable = c.status === "draft" || c.status === "paused";

  const cards: [string, number][] = [
    ["Sent", c.counts.sent],
    ["In queue", c.counts.pending + c.counts.scheduled + c.counts.sending],
    ["Failed", c.counts.failed],
    ["Skipped", c.counts.skipped],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Campaigns
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight">{c.name}</h2>
            <CampaignStatusBadge status={c.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            List: {c.listName ?? "—"} · {c.inboxIds.length} inbox
            {c.inboxIds.length === 1 ? "" : "es"} · {describeWindow(c.sendWindow)}
            {s ? ` (${s.timezone})` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {editable && (
            <Link
              href={`/campaigns/${c.id}/edit`}
              className={buttonVariants({ variant: "outline" })}
            >
              <PencilIcon />
              {c.status === "draft" ? "Continue setup" : "Edit"}
            </Link>
          )}
          {c.status === "running" && (
            <Button
              variant="outline"
              disabled={pauseResume.isPending}
              onClick={() => pauseResume.mutate({ id: c.id, action: "pause" })}
            >
              <PauseIcon />
              Pause
            </Button>
          )}
          {c.status === "paused" && (
            <Button
              disabled={pauseResume.isPending}
              onClick={() => pauseResume.mutate({ id: c.id, action: "resume" })}
            >
              <PlayIcon />
              Resume
            </Button>
          )}
          {c.status !== "running" && (
            <Button variant="destructive" onClick={() => setDeleting(true)}>
              <Trash2Icon />
              Delete
            </Button>
          )}
        </div>
      </div>

      {c.status === "draft" ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          This campaign has not started. Use “Continue setup” to finish it and press Start.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
              </div>
            ))}
            <div className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">
                {c.status === "completed" ? "Finished" : "Estimated finish"}
              </div>
              <div className="text-lg font-semibold">
                {s?.eta ? formatDayInZone(s.eta, s.timezone) : "—"}
              </div>
              {s && c.status !== "completed" && s.dailyCapacity === 0 && (
                <div className="text-xs text-destructive">No active inbox to send</div>
              )}
            </div>
          </div>
          <div className="grid gap-1">
            <ProgressBar value={c.counts.sent} max={target} className="h-2" />
            <span className="text-xs text-muted-foreground tabular-nums">
              {c.counts.sent.toLocaleString()} of {target.toLocaleString()} sent
              {c.startedAt ? ` · started ${formatDateTime(c.startedAt)}` : ""}
            </span>
          </div>
          {c.status === "running" && (
            <p className="text-xs text-muted-foreground">
              Emails are sent by the background worker (<code>npm run worker</code>). This page
              refreshes every 10 seconds.
            </p>
          )}
        </>
      )}

      {c.status !== "draft" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-lg font-semibold">Messages</h3>
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by email"
                className="w-56 pl-8"
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
          {messages.isError ? (
            <p className="text-sm text-destructive">{errorMessage(messages.error)}</p>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Inbox</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Sent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.isPending ? (
                    Array.from({ length: 4 }, (_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 5 }, (_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-5 w-full max-w-32" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : messages.data?.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No messages match.
                      </TableCell>
                    </TableRow>
                  ) : (
                    messages.data?.data.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-medium">{m.toEmail}</TableCell>
                        <TableCell>
                          {m.error ? (
                            <Tooltip>
                              <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
                                <MessageStatusBadge status={m.status} />
                              </TooltipTrigger>
                              <TooltipContent>
                                {m.error.code}: {m.error.message}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <MessageStatusBadge status={m.status} />
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {m.inboxEmail ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(m.scheduledAt)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateTime(m.sentAt)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {pageCount > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {pageCount} · {total.toLocaleString()} messages
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
        </div>
      )}

      <DeleteCampaignDialog
        campaign={deleting ? c : null}
        onClose={() => setDeleting(false)}
        onDeleted={() => router.push("/campaigns")}
      />
    </div>
  );
}
