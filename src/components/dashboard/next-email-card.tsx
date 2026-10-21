"use client";

import { TimerIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCountdown } from "@/lib/client/format";
import { useNow } from "@/lib/client/use-now";
import type { DashboardSummaryDTO } from "@/shared/dashboard";

export function NextEmailCard({ summary }: { summary: DashboardSummaryDTO | undefined }) {
  const now = useNow();
  const next = summary?.nextEmail;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TimerIcon className="size-4 text-muted-foreground" />
          Next email
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!summary ? (
          <>
            <Skeleton className="h-9 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-4 w-48" />
          </>
        ) : next ? (
          <>
            <p
              className="text-3xl font-semibold tracking-tight tabular-nums"
              suppressHydrationWarning
            >
              {formatCountdown(next.scheduledAt, now)}
            </p>
            <dl className="space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="w-10 shrink-0 text-muted-foreground">To</dt>
                <dd className="truncate font-medium">{next.to}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-10 shrink-0 text-muted-foreground">From</dt>
                <dd className="truncate">{next.fromInbox}</dd>
              </div>
            </dl>
          </>
        ) : (
          <div className="space-y-1">
            <p className="text-lg font-medium">Nothing scheduled</p>
            <p className="text-sm text-muted-foreground">
              {summary.idleReason ??
                "The planner schedules the next email within 30 seconds when a campaign is running, the window is open and an inbox is free."}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
