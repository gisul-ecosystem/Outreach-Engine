"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ClickVerdict } from "@/shared/enums";
import { VERDICT_LABELS } from "@/shared/tracking";

const STYLE: Record<ClickVerdict, string> = {
  click: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  suspicious: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  bot: "bg-muted text-muted-foreground",
};
const ICON: Record<ClickVerdict, string> = { click: "✅", suspicious: "⚠️", bot: "🤖" };

/** ✅ Real click / ⚠️ Maybe a bot / 🤖 Bot — the reasons show on hover. */
export function VerdictBadge({ verdict, reasons }: { verdict: ClickVerdict; reasons?: string[] }) {
  return (
    <Badge variant="secondary" className={cn("gap-1", STYLE[verdict])} title={reasons?.join("\n")}>
      <span aria-hidden>{ICON[verdict]}</span>
      {VERDICT_LABELS[verdict]}
    </Badge>
  );
}
