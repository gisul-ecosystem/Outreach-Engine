"use client";

import { BarChart3Icon, MailIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { SimpleSelect } from "@/components/common/simple-select";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime, formatRelative } from "@/lib/client/format";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import { cn } from "@/lib/utils";
import type {
  SentCountDTO,
  TrackedEmailDTO,
  TrackedSourceFilter,
  TrackedStatsDTO,
  TrackingPeriod,
} from "@/shared/tracked-email";
import { SentEmailsChart } from "./sent-emails-chart";
import { useTrackedEmails, useTrackedStats } from "./use-sent-emails";

const PAGE_SIZE = 25;
const ALL_INBOXES = "all";

const SOURCE_OPTIONS: { value: TrackedSourceFilter; label: string }[] = [
  { value: "manual", label: "Sent by hand (Outlook)" },
  { value: "engine", label: "Sent by the engine" },
  { value: "all", label: "All sent emails" },
];

/** How many bars each view shows, ending with the current day / week / month. */
const PERIODS: { value: TrackingPeriod; label: string; count: number }[] = [
  { value: "day", label: "Day", count: 14 },
  { value: "week", label: "Week", count: 12 },
  { value: "month", label: "Month", count: 12 },
];

type Bucket = TrackedStatsDTO["buckets"][number];

export function SentEmailsView() {
  const [source, setSource] = useState<TrackedSourceFilter>("manual");
  const [inboxId, setInboxId] = useState<string>(ALL_INBOXES);
  const [period, setPeriod] = useState<TrackingPeriod>("day");
  const [selected, setSelected] = useState<Bucket | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [wrongLinksOnly, setWrongLinksOnly] = useState(false);
  const debouncedSearch = useDebouncedValue(search.trim());

  const filters = { source, inboxId: inboxId === ALL_INBOXES ? undefined : inboxId };
  const count = PERIODS.find((p) => p.value === period)!.count;
  const stats = useTrackedStats({ ...filters, period, count });
  const emails = useTrackedEmails({
    ...filters,
    page,
    limit: PAGE_SIZE,
    search: debouncedSearch || undefined,
    from: selected?.from,
    to: selected?.to,
    wrongLinksOnly: wrongLinksOnly ? "true" : undefined,
  });

  // Any filter change starts the table again on page 1.
  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  const total = emails.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const inboxes = stats.data?.inboxes ?? [];
  const lastChecked = inboxes
    .map((i) => i.checkedAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);

  const wrongLinkEmails = stats.data?.wrongLinkEmails ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {wrongLinkEmails > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <TriangleAlertIcon className="size-4 shrink-0" />
          <span>
            {wrongLinkEmails} email(s) contain someone else&apos;s tracking link — clicks on them
            are counted for the wrong person.
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => change(setWrongLinksOnly)(!wrongLinksOnly)}
          >
            {wrongLinksOnly ? "Show all emails" : "Show them"}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <SimpleSelect
          className="w-56"
          value={source}
          onChange={(v) => change(setSource)(v as TrackedSourceFilter)}
          options={SOURCE_OPTIONS}
        />
        <SimpleSelect
          className="w-64"
          value={inboxId}
          onChange={change(setInboxId)}
          options={[
            { value: ALL_INBOXES, label: "All inboxes" },
            ...inboxes.map((i) => ({ value: i.id, label: i.email })),
          ]}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {stats.data
            ? inboxes.length === 0
              ? "No inbox is connected to a provider yet."
              : `Sent Items last read ${formatRelative(lastChecked)} · checked every 5 minutes`
            : " "}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CountCard label="Today" count={stats.data?.today} />
        <CountCard label="This week" count={stats.data?.thisWeek} />
        <CountCard label="This month" count={stats.data?.thisMonth} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <BarChart3Icon className="size-4 text-muted-foreground" />
            Emails sent per {period}
            <div className="ml-auto flex gap-1">
              {PERIODS.map((p) => (
                <Button
                  key={p.value}
                  size="sm"
                  variant={p.value === period ? "secondary" : "ghost"}
                  onClick={() => {
                    setPeriod(p.value);
                    change(setSelected)(null);
                  }}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SentEmailsChart
            buckets={stats.data?.buckets}
            selectedFrom={selected?.from ?? null}
            onSelect={(b) => change(setSelected)(b.from === selected?.from ? null : b)}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Click a bar to see who was emailed in that {period}. Times are in{" "}
            {stats.data?.timezone ?? "the app timezone"}.
          </p>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search recipient or subject"
            className="pl-8"
            value={search}
            onChange={(e) => change(setSearch)(e.target.value)}
          />
        </div>
        {selected && (
          <Badge variant="secondary" className="gap-1">
            {selected.label}
            <button
              type="button"
              aria-label="Show all periods"
              onClick={() => change(setSelected)(null)}
            >
              <XIcon className="size-3" />
            </button>
          </Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {emails.data ? `${total.toLocaleString()} email(s)` : " "}
        </span>
      </div>

      {emails.data && total === 0 ? (
        <EmptyState
          icon={MailIcon}
          title={debouncedSearch || selected ? "No match" : "No sent emails found yet"}
          description="Emails sent from your connected inboxes appear here within about 5 minutes. The worker must be running, and the app needs the Mail.Read permission."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>From inbox</TableHead>
                <TableHead>Result</TableHead>
                {source === "all" && <TableHead>Sent by</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : emails.data?.data.map((email) => (
                    <TableRow key={email.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(email.sentAt, stats.data?.timezone)}
                      </TableCell>
                      <TableCell>
                        <Recipients email={email} />
                      </TableCell>
                      <TableCell className="max-w-72 truncate">{email.subject || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{email.inboxEmail}</TableCell>
                      <TableCell>
                        <ResultBadges email={email} />
                      </TableCell>
                      {source === "all" && (
                        <TableCell>
                          <Badge variant="outline">
                            {email.source === "manual" ? "By hand" : "Engine"}
                          </Badge>
                        </TableCell>
                      )}
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

function CountCard({ label, count }: { label: string; count: SentCountDTO | undefined }) {
  return (
    <Card size="sm" className="px-4">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {count ? (
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {count.emails.toLocaleString()}
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            email(s) to {count.people.toLocaleString()} {count.people === 1 ? "person" : "people"}
          </span>
        </p>
      ) : (
        <Skeleton className="h-8 w-32" />
      )}
    </Card>
  );
}

/** Replied / ✅ clicked / ⚠️ maybe a bot / wrong link, for one email. */
function ResultBadges({ email }: { email: TrackedEmailDTO }) {
  const { clicks } = email;
  return (
    <div className="flex flex-col items-start gap-1">
      {email.repliedAt && (
        <Badge
          className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          title={`Reply from ${email.replyFromEmail ?? "?"}`}
        >
          Replied {formatRelative(email.repliedAt)}
        </Badge>
      )}
      {clicks.real > 0 ? (
        <Badge className="bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300">
          ✅ Clicked {clicks.real}×
        </Badge>
      ) : (
        clicks.total > 0 && (
          <Badge
            variant="secondary"
            title="The link was opened, but it looks like a security scanner, not a person."
          >
            ⚠️ Maybe a bot ({clicks.total})
          </Badge>
        )
      )}
      {email.wrongLinks.map((w) => (
        <Badge key={w.token} variant="destructive" className="max-w-64 whitespace-normal">
          Wrong link: this is {w.ownerName || w.ownerEmail}&apos;s link — clicks count as theirs
        </Badge>
      ))}
      {!email.repliedAt && clicks.total === 0 && email.wrongLinks.length === 0 && (
        <span className="text-muted-foreground">—</span>
      )}
    </div>
  );
}

/** To / CC / BCC addresses; addresses that are contacts in the engine show the contact's name. */
function Recipients({ email }: { email: TrackedEmailDTO }) {
  const contact = new Map(email.contacts.map((c) => [c.email, c]));
  const rows = [
    { kind: "", list: email.to },
    { kind: "CC", list: email.cc },
    { kind: "BCC", list: email.bcc },
  ].filter((r) => r.list.length > 0);

  return (
    <div className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <div key={row.kind} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {row.kind && <span className="text-xs text-muted-foreground">{row.kind}</span>}
          {row.list.map((address) => {
            const c = contact.get(address);
            return (
              <span
                key={address}
                className={cn("text-sm", c && "font-medium")}
                title={c ? `Contact: ${c.name || c.email}` : "Not a contact in the engine"}
              >
                {c?.name ? `${c.name} <${address}>` : address}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
