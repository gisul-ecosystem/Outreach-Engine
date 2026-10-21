"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button";
import { errorMessage } from "@/lib/client/api";
import { CampaignWizard } from "./campaign-wizard";
import { useCampaign } from "./use-campaigns";

/** Loads a saved campaign, then opens the wizard on it (only draft or paused campaigns are editable). */
export function CampaignEdit({ id }: { id: string }) {
  const campaign = useCampaign(id);

  if (campaign.isError) {
    return (
      <p className="text-sm text-destructive">
        Could not load the campaign: {errorMessage(campaign.error)}
      </p>
    );
  }
  if (!campaign.data) return <Skeleton className="h-96 w-full" />;
  if (campaign.data.status !== "draft" && campaign.data.status !== "paused") {
    return (
      <div className="grid w-fit gap-3 rounded-lg border p-6 text-sm">
        <p>
          {campaign.data.status === "running"
            ? "Pause the campaign before editing it."
            : "A completed campaign cannot be edited."}
        </p>
        <Link
          href={`/campaigns/${id}`}
          className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit" })}
        >
          Back to the campaign
        </Link>
      </div>
    );
  }
  // key: start the form fresh when a different campaign is opened
  return <CampaignWizard key={campaign.data.id} campaign={campaign.data} />;
}
