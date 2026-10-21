"use client";

import {
  GlobeIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/layout/empty-state";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/client/api";
import { formatDateTime, formatRelative } from "@/lib/client/format";
import type { DomainDTO } from "@/shared/domain";
import { AddDomainDialog } from "./add-domain-dialog";
import { DeleteDomainDialog } from "./delete-domain-dialog";
import { DnsBadge } from "./dns-badge";
import { DomainStatusBadge } from "./domain-status-badge";
import { useCheckDns, useDomains, useUpdateDomain } from "./use-domains";

const PAGE_SIZE = 20;
const DNS_CHECKS = ["spf", "dkim", "dmarc", "mx"] as const;

export function DomainsTable() {
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<DomainDTO | null>(null);
  const domains = useDomains({ page, limit: PAGE_SIZE });
  const checkDns = useCheckDns();
  const updateDomain = useUpdateDomain();

  const total = domains.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {domains.data ? `${total} domain${total === 1 ? "" : "s"}` : " "}
        </p>
        <AddDomainDialog />
      </div>

      {domains.isError ? (
        <div className="rounded-lg border border-destructive/30 p-6 text-sm">
          <p className="font-medium text-destructive">Could not load domains</p>
          <p className="mt-1 text-muted-foreground">{errorMessage(domains.error)}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => domains.refetch()}>
            Try again
          </Button>
        </div>
      ) : domains.data && domains.data.data.length === 0 && page === 1 ? (
        <EmptyState
          icon={GlobeIcon}
          title="No domains yet"
          description="Add your first sending domain. We'll check its SPF, DKIM, DMARC and MX records."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>DNS</TableHead>
                <TableHead className="text-right">Inboxes</TableHead>
                <TableHead>Last checked</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {domains.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 6 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : domains.data?.data.map((domain) => {
                    const checking = checkDns.isPending && checkDns.variables?.id === domain.id;
                    return (
                      <TableRow key={domain.id}>
                        <TableCell className="font-medium">{domain.name}</TableCell>
                        <TableCell>
                          <DomainStatusBadge status={domain.status} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {DNS_CHECKS.map((check) => (
                              <DnsBadge
                                key={check}
                                label={check}
                                result={domain.dns[check]}
                                records={domain.dns.records[check]}
                              />
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {domain.inboxCount}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {checking ? (
                            "Checking…"
                          ) : (
                            <Tooltip>
                              <TooltipTrigger render={<span className="cursor-default" />}>
                                {formatRelative(domain.dns.checkedAt)}
                              </TooltipTrigger>
                              <TooltipContent>
                                {formatDateTime(domain.dns.checkedAt)}
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={<Button variant="ghost" size="icon-sm" />}
                              aria-label={`Actions for ${domain.name}`}
                            >
                              <MoreHorizontalIcon />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                disabled={checking}
                                onClick={() => checkDns.mutate(domain)}
                              >
                                <RefreshCwIcon />
                                Re-check DNS
                              </DropdownMenuItem>
                              {domain.status === "active" ? (
                                <DropdownMenuItem
                                  onClick={() =>
                                    updateDomain.mutate({ id: domain.id, status: "paused" })
                                  }
                                >
                                  <PauseIcon />
                                  Pause
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() =>
                                    updateDomain.mutate({ id: domain.id, status: "active" })
                                  }
                                >
                                  <PlayIcon />
                                  Activate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setToDelete(domain)}
                              >
                                <Trash2Icon />
                                Delete
                              </DropdownMenuItem>
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

      <DeleteDomainDialog domain={toDelete} onClose={() => setToDelete(null)} />
    </div>
  );
}
