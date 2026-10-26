"use client";

import { MousePointerClickIcon } from "lucide-react";
import { useState } from "react";
import { SimpleSelect } from "@/components/common/simple-select";
import { EmptyState } from "@/components/layout/empty-state";
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
import { formatDateTime } from "@/lib/client/format";
import type { ClickFilter } from "@/shared/tracking";
import { useClicks } from "./use-tracking";
import { VerdictBadge } from "./verdict-badge";

const PAGE_SIZE = 25;
const FILTERS: { value: ClickFilter; label: string }[] = [
  { value: "real", label: "Real clicks only" },
  { value: "real-and-maybe", label: "Real + maybe a bot" },
  { value: "all", label: "Everything (bots too)" },
];

/** Every opened tracking link, newest first, with the verdict and why. */
export function ClicksView() {
  const [include, setInclude] = useState<ClickFilter>("real");
  const [page, setPage] = useState(1);
  const clicks = useClicks({ page, limit: PAGE_SIZE, include });
  const total = clicks.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SimpleSelect
          className="w-56"
          value={include}
          onChange={(v) => {
            setInclude(v as ClickFilter);
            setPage(1);
          }}
          options={FILTERS}
        />
        <span className="text-sm text-muted-foreground">
          {clicks.data ? `${total.toLocaleString()} click(s)` : " "}
        </span>
        <p className="ml-auto max-w-md text-xs text-muted-foreground">
          ⚠️ &quot;Maybe a bot&quot; = company email security often opens links by itself seconds
          after the email arrives. Hover a badge to see why.
        </p>
      </div>

      {clicks.data && total === 0 ? (
        <EmptyState
          icon={MousePointerClickIcon}
          title="No clicks yet"
          description="Copy a contact's link (Contacts → the link icon), paste it into your Outlook email, and clicks appear here."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>Why</TableHead>
                <TableHead>Went to</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clicks.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : clicks.data?.data.map((click) => (
                    <TableRow key={click.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(click.at)}
                      </TableCell>
                      <TableCell>
                        {click.contact ? (
                          <>
                            <span className="font-medium">
                              {click.contact.name || click.contact.email}
                            </span>
                            {click.contact.name && (
                              <span className="block text-xs text-muted-foreground">
                                {click.contact.email}
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <VerdictBadge verdict={click.verdict} reasons={click.reasons} />
                      </TableCell>
                      <TableCell className="max-w-80 text-xs text-muted-foreground">
                        {click.reasons.join(" ")}
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-xs text-muted-foreground">
                        {click.destinationUrl}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
