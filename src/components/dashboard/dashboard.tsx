"use client";

import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/client/api";
import { ActivityFeed } from "./activity-feed";
import { CampaignCards } from "./campaign-cards";
import { ClickersCard } from "./clickers-card";
import { InboxTable } from "./inbox-table";
import { KpiCards } from "./kpi-cards";
import { NextEmailCard } from "./next-email-card";
import { SentChart } from "./sent-chart";
import { StatusBanners } from "./status-banners";
import {
  useDashboardActivity,
  useDashboardCampaigns,
  useDashboardInboxes,
  useDashboardSummary,
  useDashboardTimeline,
} from "./use-dashboard";

export function Dashboard() {
  const summary = useDashboardSummary();
  const inboxes = useDashboardInboxes();
  const campaigns = useDashboardCampaigns();
  const timeline = useDashboardTimeline(14);
  const activity = useDashboardActivity();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Live sending progress across all inboxes. Refreshes every 10 seconds.
          </p>
        </div>
        {summary.data && (
          <p className="text-xs text-muted-foreground">Times shown in {summary.data.timezone}</p>
        )}
      </div>

      {summary.isError && !summary.data && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200">
          <span>Could not load the dashboard: {errorMessage(summary.error)}</span>
          <Button variant="outline" size="sm" onClick={() => summary.refetch()}>
            Try again
          </Button>
        </div>
      )}

      {summary.data && <StatusBanners summary={summary.data} />}
      <KpiCards summary={summary.data} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <NextEmailCard summary={summary.data} />
        </div>
        <div className="lg:col-span-2">
          <SentChart days={timeline.data} />
        </div>
      </div>

      <InboxTable inboxes={inboxes.data} />

      <ClickersCard />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CampaignCards campaigns={campaigns.data} />
        </div>
        <div className="lg:col-span-1">
          <ActivityFeed events={activity.data} />
        </div>
      </div>
    </div>
  );
}
