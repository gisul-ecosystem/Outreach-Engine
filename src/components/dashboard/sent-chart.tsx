"use client";

import { BarChart3Icon } from "lucide-react";
import { DateTime } from "luxon";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimelineDayDTO } from "@/shared/dashboard";

const SENT = "#10b981"; // emerald-500
const FAILED = "#ef4444"; // red-500

const shortDay = (date: string) => DateTime.fromISO(date).toFormat("d LLL");

export function SentChart({ days }: { days: TimelineDayDTO[] | undefined }) {
  const total = days?.reduce((sum, d) => sum + d.sent, 0) ?? 0;

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3Icon className="size-4 text-muted-foreground" />
          Emails sent per day
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            last {days?.length ?? 14} days
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!days ? (
          <Skeleton className="h-56 w-full" />
        ) : (
          <div className="relative h-56 w-full">
            {total === 0 && days.every((d) => d.failed === 0) && (
              <p className="pointer-events-none absolute z-10 w-full pt-20 text-center text-sm text-muted-foreground">
                No emails sent in this period yet.
              </p>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={days} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDay}
                  tickLine={false}
                  axisLine={false}
                  fontSize={11}
                  interval="preserveStartEnd"
                  minTickGap={16}
                />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  labelFormatter={(label) => DateTime.fromISO(String(label)).toFormat("ccc, d LLL")}
                  contentStyle={{
                    background: "var(--popover)",
                    color: "var(--popover-foreground)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="sent" name="Sent" fill={SENT} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar
                  dataKey="failed"
                  name="Failed"
                  fill={FAILED}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
