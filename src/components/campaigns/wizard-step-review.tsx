"use client";

import { AlertTriangleIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/client/api";
import { formatDayInZone } from "@/lib/client/format";
import type { CampaignDTO } from "@/shared/campaign";
import { useCampaignStats } from "./use-campaigns";
import { describeWindow, type WizardForm } from "./wizard-form";

/** Step 5: what will happen when the campaign starts (numbers come from the server). */
export function WizardStepReview({
  campaign,
  form,
}: {
  campaign: CampaignDTO | undefined;
  form: WizardForm;
}) {
  const stats = useCampaignStats(campaign?.id ?? null);

  if (stats.isError) return <p className="text-sm text-destructive">{errorMessage(stats.error)}</p>;
  if (!stats.data || !campaign) {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  const s = stats.data;
  const isDraft = s.status === "draft";
  const days = s.dailyCapacity > 0 ? Math.ceil(s.remaining / s.dailyCapacity) : null;

  const cards: [string, string, string?][] = [
    ["Contacts in list", s.audience.total.toLocaleString(), campaign.listName ?? undefined],
    [
      isDraft ? "Will get an email" : "Still to send",
      (isDraft ? s.audience.sendable : s.remaining).toLocaleString(),
    ],
    [
      "Skipped",
      s.audience.skipped.toLocaleString(),
      "Unsubscribed, bounced or on the suppression list",
    ],
    [
      "Daily capacity",
      `${s.dailyCapacity.toLocaleString()}/day`,
      `${s.usableInboxes} active inbox${s.usableInboxes === 1 ? "" : "es"}`,
    ],
    [
      "Estimated finish",
      s.eta ? formatDayInZone(s.eta, s.timezone) : "—",
      days !== null
        ? `≈ ${days} full sending day${days === 1 ? "" : "s"} at this capacity`
        : undefined,
    ],
    ["Send window", describeWindow(form.sendWindow), s.timezone],
  ];

  return (
    <div className="grid gap-5">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
            {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
          </div>
        ))}
      </dl>

      {s.usableInboxes === 0 && (
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangleIcon className="size-4" />
          None of the chosen inboxes can send (paused, deleted or domain paused). Go back to step 2.
        </p>
      )}

      <div className="grid gap-1 rounded-lg border p-4 text-sm">
        <span className="text-xs text-muted-foreground">Subject</span>
        <span className="font-medium">{form.subjectTemplate || "(empty)"}</span>
        <span className="mt-3 text-xs text-muted-foreground">Email</span>
        <p className="max-h-56 overflow-y-auto whitespace-pre-wrap">{form.bodyTemplate}</p>
      </div>

      {isDraft && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Start</span> puts one email per contact in
          the queue. The background worker then sends them one by one, with random gaps, only inside
          the send window and never more than each inbox’s daily limit. You can pause at any time.
        </p>
      )}
    </div>
  );
}
