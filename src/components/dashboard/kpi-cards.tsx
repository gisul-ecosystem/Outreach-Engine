"use client";

import {
  AlertTriangleIcon,
  CalendarDaysIcon,
  InboxIcon,
  MailCheckIcon,
  MousePointerClickIcon,
  SendIcon,
  ServerIcon,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { DashboardSummaryDTO } from "@/shared/dashboard";

type Kpi = {
  label: string;
  icon: LucideIcon;
  value: (s: DashboardSummaryDTO) => number;
  tint: string;
  /** Highlight the number in red when it is above zero. */
  alert?: boolean;
};

const KPIS: Kpi[] = [
  {
    label: "Sent today",
    icon: SendIcon,
    value: (s) => s.sentToday,
    tint: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
  {
    label: "Sent this week",
    icon: CalendarDaysIcon,
    value: (s) => s.sentThisWeek,
    tint: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  },
  {
    label: "Total sent",
    icon: MailCheckIcon,
    value: (s) => s.totalSent,
    tint: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  },
  {
    label: "In queue",
    icon: InboxIcon,
    value: (s) => s.inQueue,
    tint: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  {
    label: "Failed today",
    icon: AlertTriangleIcon,
    value: (s) => s.failedToday,
    tint: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
    alert: true,
  },
  {
    label: "Active inboxes",
    icon: ServerIcon,
    value: (s) => s.activeInboxes,
    tint: "bg-muted text-muted-foreground",
  },
  {
    label: "Real clicks this week",
    icon: MousePointerClickIcon,
    value: (s) => s.realClicksThisWeek,
    tint: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  },
];

export function KpiCards({ summary }: { summary: DashboardSummaryDTO | undefined }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {KPIS.map((kpi) => {
        const value = summary ? kpi.value(summary) : null;
        return (
          <Card key={kpi.label} size="sm" className="px-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{kpi.label}</span>
              <span className={cn("flex size-7 items-center justify-center rounded-md", kpi.tint)}>
                <kpi.icon className="size-4" />
              </span>
            </div>
            {value === null ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <p
                className={cn(
                  "text-2xl font-semibold tracking-tight tabular-nums",
                  kpi.alert && value > 0 && "text-red-600 dark:text-red-400",
                )}
              >
                {value.toLocaleString()}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
