"use client";

import { MousePointerClickIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAgo } from "@/lib/client/format";
import { useNow } from "@/lib/client/use-now";
import type { ClickersPeriod } from "@/shared/dashboard";
import { useDashboardClickers } from "./use-dashboard";

const PERIODS: { value: ClickersPeriod; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "all", label: "All time" },
];

/** How many times each person opened their tracking link — real clicks and bot opens separately. */
export function ClickersCard() {
  const [period, setPeriod] = useState<ClickersPeriod>("week");
  const clickers = useDashboardClickers(period);
  const now = useNow();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <MousePointerClickIcon className="size-4 text-muted-foreground" />
          Clicks per person
          <div className="ml-auto flex gap-1">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                size="sm"
                variant={p.value === period ? "secondary" : "ghost"}
                onClick={() => setPeriod(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!clickers.data ? (
          <Skeleton className="h-32 w-full" />
        ) : clickers.data.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nobody has opened a tracking link {period === "week" ? "this week" : "yet"}. Copy a
            contact&apos;s link on the Contacts page and paste it into your email.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead className="text-right">✅ Real clicks</TableHead>
                  <TableHead className="text-right">⚠️ Bot opens</TableHead>
                  <TableHead>Last real click</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clickers.data.map((c) => (
                  <TableRow key={c.contactId}>
                    <TableCell>
                      <span className="font-medium">{c.name || c.email}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.name ? c.email : ""}
                        {c.name && c.company ? " · " : ""}
                        {c.company}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-lg font-semibold tabular-nums">
                      {c.realClicks}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {c.botOpens}
                    </TableCell>
                    <TableCell className="text-muted-foreground" suppressHydrationWarning>
                      {c.lastRealClickAt ? formatAgo(c.lastRealClickAt, now) : "— (only bots)"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">
              Bot opens are company email security checking the link — not interest. Every click
              with its time:{" "}
              <Link href="/sent" className="underline">
                Sent emails → Link clicks
              </Link>
              .
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
