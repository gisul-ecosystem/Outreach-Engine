"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import type { TrackedStatsDTO } from "@/shared/tracked-email";

type Bucket = TrackedStatsDTO["buckets"][number];

const EMAILS = "#10b981"; // emerald-500
const SELECTED = "#047857"; // emerald-700

/** Emails sent per day / week / month. Clicking a bar shows that period's emails in the table. */
export function SentEmailsChart({
  buckets,
  selectedFrom,
  onSelect,
}: {
  buckets: Bucket[] | undefined;
  selectedFrom: string | null;
  onSelect: (bucket: Bucket) => void;
}) {
  if (!buckets) return <Skeleton className="h-56 w-full" />;
  const empty = buckets.every((b) => b.emails === 0);

  return (
    <div className="relative h-56 w-full">
      {empty && (
        <p className="pointer-events-none absolute z-10 w-full pt-20 text-center text-sm text-muted-foreground">
          No emails sent in this period yet.
        </p>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={buckets} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            fontSize={11}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            formatter={(value, _name, item) => [
              `${value} email(s) to ${(item.payload as Bucket).people} people`,
              "Sent",
            ]}
            contentStyle={{
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar
            dataKey="emails"
            name="Sent"
            fill={EMAILS}
            radius={[4, 4, 0, 0]}
            maxBarSize={28}
            className="cursor-pointer"
            onClick={(_data, index) => onSelect(buckets[index])}
          >
            {/* The selected period's bar in a darker green. */}
            {buckets.map((b) => (
              <Cell key={b.from} fill={b.from === selectedFrom ? SELECTED : EMAILS} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
