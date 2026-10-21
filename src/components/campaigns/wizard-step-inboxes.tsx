"use client";

import Link from "next/link";
import { InboxStatusBadge } from "@/components/inboxes/inbox-status-badge";
import { useInboxes } from "@/components/inboxes/use-inboxes";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MAX_CAMPAIGN_INBOXES } from "@/shared/campaign";
import type { WizardForm } from "./wizard-form";

/** Step 2: which inboxes send this campaign. Shows each daily limit and the total daily capacity. */
export function WizardStepInboxes({
  form,
  onChange,
}: {
  form: WizardForm;
  onChange: (patch: Partial<WizardForm>) => void;
}) {
  const inboxes = useInboxes({ page: 1, limit: MAX_CAMPAIGN_INBOXES });
  const all = inboxes.data?.data ?? [];
  const selected = new Set(form.inboxIds);
  const chosen = all.filter((i) => selected.has(i.id));
  const capacity = chosen
    .filter((i) => i.status === "active")
    .reduce((s, i) => s + i.dailyLimit, 0);
  const notActive = chosen.filter((i) => i.status !== "active").length;
  const activeIds = all.filter((i) => i.status === "active").map((i) => i.id);

  const toggle = (id: string) =>
    onChange({
      inboxIds: selected.has(id) ? form.inboxIds.filter((x) => x !== id) : [...form.inboxIds, id],
    });

  if (inboxes.data && all.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No inboxes yet.{" "}
        <Link href="/inboxes" className="underline underline-offset-4">
          Add an inbox
        </Link>{" "}
        first, then come back to this draft.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Emails are spread over the chosen inboxes. Each inbox sends at most its daily limit.
        </p>
        <Button variant="outline" size="sm" onClick={() => onChange({ inboxIds: activeIds })}>
          Select all active
        </Button>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <span className="sr-only">Use</span>
              </TableHead>
              <TableHead>Inbox</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Daily limit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inboxes.isPending
              ? Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 5 }, (_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-5 w-full max-w-32" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : all.map((inbox) => (
                  <TableRow
                    key={inbox.id}
                    className="cursor-pointer"
                    onClick={() => toggle(inbox.id)}
                    data-state={selected.has(inbox.id) ? "selected" : undefined}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={selected.has(inbox.id)}
                        onChange={() => toggle(inbox.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Use ${inbox.email}`}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{inbox.email}</span>
                      {inbox.displayName && (
                        <span className="block text-xs text-muted-foreground">
                          {inbox.displayName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{inbox.domainName}</TableCell>
                    <TableCell>
                      <InboxStatusBadge status={inbox.status} reason={inbox.pauseReason} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {inbox.dailyLimit}/day
                    </TableCell>
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>
      <div className="rounded-lg bg-muted/50 p-3 text-sm">
        <span className="font-medium">
          {chosen.length} inbox{chosen.length === 1 ? "" : "es"} selected · total daily capacity:{" "}
          {capacity.toLocaleString()} emails/day
        </span>
        {notActive > 0 && (
          <span className="mt-1 block text-muted-foreground">
            {notActive} selected inbox{notActive === 1 ? " is" : "es are"} not active and will not
            send until resumed (not counted above).
          </span>
        )}
      </div>
    </div>
  );
}
