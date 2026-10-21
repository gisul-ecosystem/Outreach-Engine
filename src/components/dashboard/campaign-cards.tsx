"use client";

import { MegaphoneIcon, PauseIcon, PlayIcon } from "lucide-react";
import Link from "next/link";
import { CampaignStatusBadge, ProgressBar } from "@/components/campaigns/campaign-status-badge";
import { usePauseResumeCampaign } from "@/components/campaigns/use-campaigns";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDayInZone } from "@/lib/client/format";
import type { DashboardCampaignDTO } from "@/shared/dashboard";

function CampaignCard({ campaign }: { campaign: DashboardCampaignDTO }) {
  const pauseResume = usePauseResumeCampaign();
  const percent =
    campaign.total > 0 ? Math.min(100, Math.round((campaign.sent / campaign.total) * 100)) : 0;
  const busy = pauseResume.isPending;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <Link href={`/campaigns/${campaign.id}`} className="min-w-0 font-medium hover:underline">
          <span className="block truncate">{campaign.name}</span>
        </Link>
        <CampaignStatusBadge status={campaign.status} />
      </div>
      <div className="space-y-1.5">
        <ProgressBar value={campaign.sent} max={campaign.total} className="h-2" />
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {campaign.sent.toLocaleString()} / {campaign.total.toLocaleString()} sent
          </span>
          <span>{percent}%</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {campaign.status === "completed" ? "Finished" : "ETA"}{" "}
          <span className="font-medium text-foreground">
            {campaign.eta ? formatDayInZone(campaign.eta, campaign.timezone) : "—"}
          </span>
          {campaign.failed > 0 && (
            <span className="ml-2 text-red-600">{campaign.failed} failed</span>
          )}
        </p>
        {campaign.status === "running" && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => pauseResume.mutate({ id: campaign.id, action: "pause" })}
          >
            <PauseIcon /> Pause
          </Button>
        )}
        {campaign.status === "paused" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => pauseResume.mutate({ id: campaign.id, action: "resume" })}
          >
            <PlayIcon /> Resume
          </Button>
        )}
      </div>
    </div>
  );
}

export function CampaignCards({ campaigns }: { campaigns: DashboardCampaignDTO[] | undefined }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MegaphoneIcon className="size-4 text-muted-foreground" />
          Campaigns
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!campaigns ? (
          <div className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 2 }, (_, i) => (
              <Skeleton key={i} className="h-32 w-full" />
            ))}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">No campaigns have started yet.</p>
            <Link
              href="/campaigns/new"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Create a campaign
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
