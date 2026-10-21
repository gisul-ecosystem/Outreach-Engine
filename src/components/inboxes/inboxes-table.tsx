"use client";

import {
  InboxIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { SimpleSelect } from "@/components/common/simple-select";
import { useDomains } from "@/components/domains/use-domains";
import { EmptyState } from "@/components/layout/empty-state";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { formatRelative } from "@/lib/client/format";
import type { InboxDTO } from "@/shared/inbox";
import { EditInboxDialog } from "./edit-inbox-dialog";
import { ImportMailboxesDialog } from "./import-mailboxes-dialog";
import { InboxStatusBadge } from "./inbox-status-badge";
import { TestSendDialog } from "./test-send-dialog";
import { useDeleteInbox, useInboxes, usePauseResumeInbox } from "./use-inboxes";

const PAGE_SIZE = 20;
const ALL = "all";

const gapLabel = (min: number, max: number) => {
  const fmt = (s: number) => (s >= 60 ? `${Math.round((s / 60) * 10) / 10}m` : `${s}s`);
  return `${fmt(min)}–${fmt(max)}`;
};

export function InboxesTable() {
  const [page, setPage] = useState(1);
  const [domainFilter, setDomainFilter] = useState<string>(ALL);
  const [editing, setEditing] = useState<InboxDTO | null>(null);
  const [testing, setTesting] = useState<InboxDTO | null>(null);
  const [toDelete, setToDelete] = useState<InboxDTO | null>(null);

  const domains = useDomains({ page: 1, limit: 100 });
  const inboxes = useInboxes({
    page,
    limit: PAGE_SIZE,
    domainId: domainFilter === ALL ? undefined : domainFilter,
  });
  const pauseResume = usePauseResumeInbox();
  const remove = useDeleteInbox();

  const total = inboxes.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const domainOptions = [
    { value: ALL, label: "All domains" },
    ...(domains.data?.data ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SimpleSelect
            value={domainFilter}
            onChange={(value) => {
              setDomainFilter(value);
              setPage(1);
            }}
            options={domainOptions}
            className="w-56"
          />
          <span className="text-sm text-muted-foreground">
            {inboxes.data ? `${total} inbox${total === 1 ? "" : "es"}` : " "}
          </span>
        </div>
        <ImportMailboxesDialog defaultDomainId={domainFilter === ALL ? undefined : domainFilter} />
      </div>

      {inboxes.isError ? (
        <div className="rounded-lg border border-destructive/30 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load inboxes</p>
          <p className="mt-1 text-muted-foreground">{errorMessage(inboxes.error)}</p>
        </div>
      ) : inboxes.data && inboxes.data.data.length === 0 && page === 1 ? (
        <EmptyState
          icon={InboxIcon}
          title={domainFilter === ALL ? "No inboxes yet" : "No inboxes on this domain"}
          description="Add the Microsoft 365 mailboxes that should send your campaigns."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inbox</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Daily limit</TableHead>
                <TableHead>Gap</TableHead>
                <TableHead>Last sent</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inboxes.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 7 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : inboxes.data?.data.map((inbox) => (
                    <TableRow key={inbox.id}>
                      <TableCell>
                        <span className="font-medium">{inbox.email}</span>
                        {inbox.displayName && (
                          <span className="block text-xs text-muted-foreground">
                            {inbox.displayName}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{inbox.domainName}</TableCell>
                      <TableCell>
                        <InboxStatusBadge status={inbox.status} reason={inbox.pauseReason} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{inbox.dailyLimit}</TableCell>
                      <TableCell className="tabular-nums">
                        {gapLabel(inbox.minGapSeconds, inbox.maxGapSeconds)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelative(inbox.lastSentAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-sm" />}
                            aria-label={`Actions for ${inbox.email}`}
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setTesting(inbox)}>
                              <SendIcon />
                              Send test email
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditing(inbox)}>
                              <PencilIcon />
                              Edit
                            </DropdownMenuItem>
                            {inbox.status === "active" ? (
                              <DropdownMenuItem
                                onClick={() => pauseResume.mutate({ inbox, action: "pause" })}
                              >
                                <PauseIcon />
                                Pause
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                onClick={() => pauseResume.mutate({ inbox, action: "resume" })}
                              >
                                <PlayIcon />
                                Resume
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setToDelete(inbox)}
                            >
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
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

      <EditInboxDialog inbox={editing} onClose={() => setEditing(null)} />
      <TestSendDialog inbox={testing} onClose={() => setTesting(null)} />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {toDelete?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops sending immediately. Its scheduled emails go back to the queue for other
              inboxes. Sending history and stats are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                toDelete && remove.mutate(toDelete, { onSuccess: () => setToDelete(null) })
              }
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
