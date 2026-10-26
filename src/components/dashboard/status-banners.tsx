"use client";

import {
  AlertTriangleIcon,
  FlaskConicalIcon,
  PauseCircleIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardSummaryDTO } from "@/shared/dashboard";

function Banner({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: LucideIcon;
  tone: "yellow" | "red" | "grey";
  title: string;
  children?: React.ReactNode;
}) {
  const tones = {
    yellow:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-200",
    red: "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200",
    grey: "border-border bg-muted text-foreground",
  };
  return (
    <div
      role="status"
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 text-sm", tones[tone])}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        <p className="font-medium">{title}</p>
        {children && <p className="mt-0.5 opacity-80">{children}</p>}
      </div>
    </div>
  );
}

/** Yellow = dry run, red = worker stopped or campaign auto-paused, grey = kill switch. Several can show at once. */
export function StatusBanners({ summary }: { summary: DashboardSummaryDTO }) {
  const banners = [];
  if (summary.mode === "dry-run") {
    banners.push(
      <Banner
        key="dry"
        icon={FlaskConicalIcon}
        tone="yellow"
        title="DRY RUN — no real emails are being sent"
      >
        The fake provider is used. Set DRY_RUN=false and SENDING_ENABLED=true in .env.local to send
        for real.
      </Banner>,
    );
  }
  if (summary.mode === "disabled") {
    banners.push(
      <Banner key="kill" icon={PauseCircleIcon} tone="grey" title="Sending paused (kill switch)">
        SENDING_ENABLED=false — the worker plans and sends nothing until it is turned on.
      </Banner>,
    );
  }
  for (const alert of summary.alerts ?? []) {
    banners.push(
      <Banner
        key={`alert-${alert.campaignId}`}
        icon={AlertTriangleIcon}
        tone="red"
        title={`Campaign “${alert.campaignName}” was paused automatically`}
      >
        {alert.reason} Fix the cause, then press Resume on the campaign.
      </Banner>,
    );
  }
  if (!summary.workerRunning) {
    banners.push(
      <Banner key="worker" icon={AlertTriangleIcon} tone="red" title="Worker is not running">
        Nothing is being sent. Start it with <strong>npm run worker</strong> (or npm run dev:all).
      </Banner>,
    );
  }
  if (banners.length === 0) return null;
  return <div className="space-y-2">{banners}</div>;
}
