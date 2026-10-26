"use client";

import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  OctagonXIcon,
  PencilIcon,
  RefreshCwIcon,
  SendIcon,
} from "lucide-react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useCheckDns } from "@/components/domains/use-domains";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/client/query-keys";
import { cn } from "@/lib/utils";
import {
  summarize,
  type ReadinessFix,
  type ReadinessItem,
  type ReadinessLevel,
} from "@/shared/readiness";

const LEVELS: Record<
  ReadinessLevel,
  { icon: typeof CheckCircle2Icon; heading: string; className: string; iconClass: string }
> = {
  error: {
    icon: OctagonXIcon,
    heading: "Must fix — Start is blocked until these are fixed",
    className:
      "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200",
    iconClass: "text-red-600 dark:text-red-400",
  },
  warning: {
    icon: CircleAlertIcon,
    heading: "Warnings — you can still start",
    className:
      "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  ok: {
    icon: CheckCircle2Icon,
    heading: "Passed",
    className: "",
    iconClass: "text-green-600 dark:text-green-400",
  },
};

/** Re-runs the DNS check of one domain, then refreshes the readiness list. */
function RecheckDnsButton({ domainId }: { domainId: string }) {
  const checkDns = useCheckDns();
  const queryClient = useQueryClient();
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={checkDns.isPending}
      onClick={() =>
        checkDns.mutate(
          { id: domainId, name: "" },
          { onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.campaigns.all }) },
        )
      }
    >
      <RefreshCwIcon />
      {checkDns.isPending ? "Checking…" : "Re-check DNS"}
    </Button>
  );
}

function FixButtons({
  item,
  onFix,
  onSendTest,
}: {
  item: ReadinessItem;
  onFix?: (item: ReadinessItem, fix: ReadinessFix) => void;
  onSendTest?: () => void;
}) {
  const buttons = (item.fixes ?? []).flatMap((fix, i) => {
    const key = `${item.key}:${i}`;
    switch (fix.kind) {
      case "insert":
      case "replace":
        return onFix
          ? [
              <Button
                key={key}
                type="button"
                size="xs"
                variant="outline"
                onClick={() => onFix(item, fix)}
              >
                {fix.label}
              </Button>,
            ]
          : [];
      case "show":
        return onFix
          ? [
              <Button
                key={key}
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => onFix(item, fix)}
              >
                Show me
              </Button>,
            ]
          : [];
      case "link":
        return [
          <Link
            key={key}
            href={fix.href}
            className={buttonVariants({ size: "xs", variant: "outline" })}
          >
            {fix.label}
          </Link>,
        ];
      case "send-test":
        return onSendTest
          ? [
              <Button key={key} type="button" size="xs" variant="outline" onClick={onSendTest}>
                <SendIcon />
                Send test to myself
              </Button>,
            ]
          : [];
      case "recheck-dns":
        return [<RecheckDnsButton key={key} domainId={fix.domainId} />];
    }
  });
  return buttons.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{buttons}</div> : null;
}

function ItemRow({
  item,
  versionNames,
  onFix,
  onSendTest,
}: {
  item: ReadinessItem;
  versionNames?: string[];
  onFix?: (item: ReadinessItem, fix: ReadinessFix) => void;
  onSendTest?: () => void;
}) {
  const { icon: Icon, iconClass } = LEVELS[item.level];
  const version =
    versionNames && versionNames.length > 1 && item.template !== undefined
      ? versionNames[item.template] || `Version ${item.template + 1}`
      : null;
  return (
    <li className="flex gap-2">
      <Icon className={cn("mt-0.5 size-4 shrink-0", iconClass)} aria-hidden />
      <div className="min-w-0 flex-1">
        <span>
          {version && (
            <span className="mr-1.5 rounded bg-background/70 px-1.5 py-0.5 text-xs font-medium">
              {version}
            </span>
          )}
          {item.message}
        </span>
        {item.level !== "ok" && <FixButtons item={item} onFix={onFix} onSendTest={onSendTest} />}
      </div>
    </li>
  );
}

/**
 * The "Outlook readiness" list: a score, then Must fix (red), Warnings (amber) and the passed checks
 * (green, folded). "Add it" / "Show me" buttons appear when `onFix` is given (the email editor).
 */
export function ReadinessPanel({
  items,
  versionNames,
  onFix,
  onSendTest,
  onEditEmail,
  loading,
  title = "Outlook readiness",
  className,
}: {
  items: ReadinessItem[];
  versionNames?: string[];
  onFix?: (item: ReadinessItem, fix: ReadinessFix) => void;
  onSendTest?: () => void;
  /** Shown as "Edit the email" when an email problem cannot be fixed from here. */
  onEditEmail?: () => void;
  loading?: boolean;
  title?: string;
  className?: string;
}) {
  const summary = summarize(items);
  const byLevel = (level: ReadinessLevel) => items.filter((i) => i.level === level);
  const emailProblem = items.some((i) => i.level !== "ok" && i.template !== undefined);

  return (
    <section
      className={cn("grid gap-3 rounded-lg border p-3 text-sm", className)}
      aria-label={title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-medium">{title}</h3>
          {loading ? (
            <Skeleton className="mt-1 h-4 w-32" />
          ) : (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {summary.passed} of {summary.total} checks passed
              {summary.errors ? ` · ${summary.errors} must fix` : ""}
              {summary.warnings
                ? ` · ${summary.warnings} warning${summary.warnings === 1 ? "" : "s"}`
                : ""}
            </p>
          )}
        </div>
        {onEditEmail && emailProblem && (
          <Button type="button" size="sm" variant="outline" onClick={onEditEmail}>
            <PencilIcon />
            Edit the email
          </Button>
        )}
      </div>

      {(["error", "warning"] as const).map((level) => {
        const list = byLevel(level);
        if (!list.length) return null;
        return (
          <div
            key={level}
            className={cn("grid gap-2 rounded-lg border p-3", LEVELS[level].className)}
          >
            <span className="text-xs font-semibold tracking-wide uppercase">
              {LEVELS[level].heading}
            </span>
            <ul className="grid gap-2">
              {list.map((item) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  versionNames={versionNames}
                  onFix={onFix}
                  onSendTest={onSendTest}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {byLevel("ok").length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
            {byLevel("ok").length} passed check{byLevel("ok").length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 grid gap-1.5 text-muted-foreground">
            {byLevel("ok").map((item) => (
              <ItemRow key={item.key} item={item} versionNames={versionNames} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
