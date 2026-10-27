"use client";

import { Download, MousePointerClickIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { useLists } from "@/components/contacts/use-contacts";
import { apiFetchPage, errorMessage } from "@/lib/client/api";
import { formatDateTime } from "@/lib/client/format";
import { type ClickFilter, type LinkClickDTO, VERDICT_LABELS } from "@/shared/tracking";
import { useClicks } from "./use-tracking";
import { VerdictBadge } from "./verdict-badge";

const PAGE_SIZE = 25;
/** Biggest `limit` the list endpoints accept (paginationSchema). */
const MAX_PAGE_LIMIT = 100;

/** Quotes a CSV cell when needed; a leading = + - @ is defused so Excel doesn't run it as a formula. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
const FILTERS: { value: ClickFilter; label: string }[] = [
  { value: "real", label: "Real clicks only" },
  { value: "real-and-maybe", label: "Real + maybe a bot" },
  { value: "all", label: "Everything (bots too)" },
];

/** Every opened tracking link, newest first, with the verdict and why. */
export function ClicksView() {
  const [include, setInclude] = useState<ClickFilter>("real");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>("");
  // The API allows at most 100 per page (a bigger limit is rejected and no list shows up).
  const lists = useLists({ page: 1, limit: MAX_PAGE_LIMIT });
  const clicks = useClicks({
    page,
    limit: PAGE_SIZE,
    include,
    ...(selectedListId && { listId: selectedListId }),
  });
  const total = clicks.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const listOptions = [
    { value: "", label: "All lists" },
    ...(lists.data?.data ?? []).map((list) => ({
      value: list.id,
      label: `${list.name} (${list.contactCount} contacts)`,
    })),
  ];

  const handleExportCsv = async () => {
    setIsExporting(true);
    try {
      // Every click for the current filters, a page at a time.
      const allClicks: LinkClickDTO[] = [];
      for (let p = 1; ; p++) {
        const params = new URLSearchParams({
          include,
          limit: String(MAX_PAGE_LIMIT),
          page: String(p),
          ...(selectedListId && { listId: selectedListId }),
        });
        const result = await apiFetchPage<LinkClickDTO>(`/api/tracking/clicks?${params}`);
        allClicks.push(...result.data);
        if (result.data.length < MAX_PAGE_LIMIT || allClicks.length >= result.total) break;
      }

      const headers = [
        "When",
        "Contact Name",
        "Contact Email",
        "Verdict",
        "Reasons",
        "Destination URL",
      ];
      const rows = allClicks.map((click) => [
        formatDateTime(click.at),
        click.contact?.name ?? "",
        click.contact?.email ?? "",
        VERDICT_LABELS[click.verdict],
        click.reasons.join("; "),
        click.destinationUrl,
      ]);
      const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

      const listName = selectedListId
        ? (lists.data?.data.find((l) => l.id === selectedListId)?.name ?? "list")
        : "all-lists";
      const slug = listName.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "list";
      // The BOM makes Excel read names with accents correctly.
      const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `link-clicks-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`Exported ${allClicks.length.toLocaleString()} click(s)`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

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
        <div className="flex flex-col">
          <SimpleSelect
            className="w-64"
            value={selectedListId}
            onChange={(v) => {
              setSelectedListId(v);
              setPage(1);
            }}
            options={listOptions}
            disabled={lists.isPending}
          />
          {lists.isPending && (
            <span className="mt-1 text-xs text-muted-foreground">Loading lists...</span>
          )}
          {lists.isError && (
            <span className="mt-1 text-xs text-destructive">
              Could not load lists: {errorMessage(lists.error)}
            </span>
          )}
          {lists.data?.data.length === 0 && (
            <span className="mt-1 text-xs text-muted-foreground">No lists found</span>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {clicks.data ? `${total.toLocaleString()} click(s)` : " "}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExportCsv}
          disabled={isExporting || !clicks.data || total === 0}
          className="ml-auto"
        >
          <Download className="size-4" />
          {isExporting ? "Exporting…" : "Export CSV"}
        </Button>
        <p className="ml-2 max-w-md text-xs text-muted-foreground">
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
