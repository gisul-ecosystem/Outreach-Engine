"use client";

import { Download, MousePointerClickIcon } from "lucide-react";
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
import { useLists } from "@/components/contacts/use-contacts";
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
  const [isExporting, setIsExporting] = useState(false);
  const [selectedListId, setSelectedListId] = useState<string>("");
  const lists = useLists({ page: 1, limit: 1000 });
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
      label: `${list.name} (${list.contactCount || 0} contacts)`,
    })),
  ];

  // Debug: Log lists data
  console.log("Lists loaded:", lists.data?.data?.length, lists.data?.data);

  const handleExportCsv = async () => {
    if (!clicks.data) return;

    setIsExporting(true);
    try {
      // Fetch all clicks data by handling pagination (API max limit is 100)
      const allClicks: any[] = [];
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const params = new URLSearchParams({
          include,
          limit: "100",
          page: String(page),
          ...(selectedListId && { listId: selectedListId }),
        });
        const response = await fetch(`/api/tracking/clicks?${params}`);
        if (!response.ok) throw new Error("Failed to fetch clicks data");

        const data = await response.json();
        if (!data.data || data.data.length === 0) {
          hasMore = false;
        } else {
          allClicks.push(...data.data);
          page++;
        }
      }

      const clicksData = allClicks;

      // Prepare CSV content
      const headers = [
        "When",
        "Contact Name",
        "Contact Email",
        "Verdict",
        "Reasons",
        "Destination URL",
      ];

      const rows = clicksData.map((click: any) => [
        formatDateTime(click.at),
        click.contact?.name || "",
        click.contact?.email || "",
        click.verdict,
        click.reasons.join("; "),
        click.destinationUrl,
      ]);

      // Escape CSV fields
      const escapeCsv = (field: string) => {
        if (typeof field !== "string") return field;
        if (field.includes(",") || field.includes('"') || field.includes("\n")) {
          return `"${field.replace(/"/g, '""')}"`;
        }
        return field;
      };

      const csvContent = [
        headers.map(escapeCsv).join(","),
        ...rows.map((row: any[]) => row.map(escapeCsv).join(",")),
      ].join("\n");

      // Download CSV
      const listName = selectedListId
        ? lists.data?.data.find((l) => l.id === selectedListId)?.name || "list"
        : "all-lists";
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `link-clicks-${listName}-${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export clicks data");
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
            <span className="text-xs text-muted-foreground mt-1">Loading lists...</span>
          )}
          {!lists.isPending && lists.data?.data && lists.data.data.length === 0 && (
            <span className="text-xs text-muted-foreground mt-1">No lists found</span>
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
