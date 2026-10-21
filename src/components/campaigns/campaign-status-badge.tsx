import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CampaignStatus, MessageStatus } from "@/shared/enums";

const CAMPAIGN: Record<CampaignStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  running: {
    label: "Running",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  paused: {
    label: "Paused",
    className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  completed: {
    label: "Completed",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
};

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  pending: "Pending",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  skipped: "Skipped",
};

const MESSAGE: Record<MessageStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  scheduled: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  sending: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  sent: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  skipped: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
};

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const { label, className } = CAMPAIGN[status];
  return <Badge className={className}>{label}</Badge>;
}

export function MessageStatusBadge({ status }: { status: MessageStatus }) {
  return <Badge className={MESSAGE[status]}>{MESSAGE_STATUS_LABELS[status]}</Badge>;
}

/** Thin progress bar: `value` of `max`. */
export function ProgressBar({
  value,
  max,
  className,
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div
        className="h-full rounded-full bg-emerald-500 transition-all"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
