"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { DnsCheckResult } from "@/shared/enums";

const STYLES: Record<DnsCheckResult, string> = {
  pass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  fail: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  unknown: "bg-muted text-muted-foreground",
};

const MEANING: Record<DnsCheckResult, string> = {
  pass: "Set up correctly",
  fail: "Missing or wrong",
  unknown: "Could not check (DNS lookup failed) — try Re-check DNS",
};

/** Green = pass, red = fail, grey = unknown. Hover shows the DNS record that was found. */
export function DnsBadge({
  label,
  result,
  records,
}: {
  label: string;
  result: DnsCheckResult;
  records: string[];
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
        <Badge className={cn("uppercase", STYLES[result])}>{label}</Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-md flex-col items-start">
        <span className="font-medium">
          {label}: {MEANING[result]}
        </span>
        {records.length > 0 ? (
          records.map((record) => (
            <code key={record} className="font-mono break-all">
              {record}
            </code>
          ))
        ) : (
          <span className="opacity-80">No record found</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
