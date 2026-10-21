"use client";

import { MailIcon } from "lucide-react";
import Link from "next/link";
import { ProgressBar } from "@/components/campaigns/campaign-status-badge";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAgo, formatCountdown } from "@/lib/client/format";
import { useNow } from "@/lib/client/use-now";
import { cn } from "@/lib/utils";
import type { DashboardInboxDTO } from "@/shared/dashboard";
import type { InboxStatus } from "@/shared/enums";

const STATUS: Record<InboxStatus, { label: string; className: string }> = {
  active: {
    label: "Active",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  paused: {
    label: "Paused",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  error: { label: "Error", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

export function InboxTable({ inboxes }: { inboxes: DashboardInboxDTO[] | undefined }) {
  const now = useNow();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MailIcon className="size-4 text-muted-foreground" />
          Inboxes
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!inboxes ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : inboxes.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              No inboxes yet. Add one to start sending.
            </p>
            <Link href="/inboxes" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Go to Inboxes
            </Link>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Inbox</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[26%]">Sent today</TableHead>
                <TableHead>Last sent</TableHead>
                <TableHead className="text-right">Next send</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {inboxes.map((inbox) => {
                const full = inbox.sentToday >= inbox.dailyLimit;
                return (
                  <TableRow key={inbox.id}>
                    <TableCell>
                      <p className="font-medium">{inbox.email}</p>
                      <p className="text-xs text-muted-foreground">{inbox.domain}</p>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS[inbox.status].className}>
                        {STATUS[inbox.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <ProgressBar
                          value={inbox.sentToday}
                          max={inbox.dailyLimit}
                          className="h-2 min-w-16 flex-1"
                        />
                        <span
                          className={cn(
                            "text-xs whitespace-nowrap tabular-nums",
                            full ? "font-medium text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {inbox.sentToday} / {inbox.dailyLimit}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground" suppressHydrationWarning>
                      {formatAgo(inbox.lastSentAt, now)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums" suppressHydrationWarning>
                      {inbox.status !== "active" ? (
                        <span
                          className="text-muted-foreground"
                          title={inbox.pauseReason ?? undefined}
                        >
                          —
                        </span>
                      ) : inbox.nextScheduledAt ? (
                        formatCountdown(inbox.nextScheduledAt, now)
                      ) : (
                        <span className="text-muted-foreground">
                          {full ? "done for today" : "—"}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
