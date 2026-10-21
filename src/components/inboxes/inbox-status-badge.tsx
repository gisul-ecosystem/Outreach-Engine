"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { InboxStatus } from "@/shared/enums";

const STYLES: Record<InboxStatus, { label: string; className: string }> = {
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

/** Status badge; hovering a paused/error badge shows why. */
export function InboxStatusBadge({
  status,
  reason,
}: {
  status: InboxStatus;
  reason?: string | null;
}) {
  const { label, className } = STYLES[status];
  const badge = <Badge className={className}>{label}</Badge>;
  if (!reason || status === "active") return badge;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-help" />}>{badge}</TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
