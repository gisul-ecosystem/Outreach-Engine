"use client";

import { InboxIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SimpleSelect } from "@/components/common/simple-select";
import { EmptyState } from "@/components/layout/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import type { IncomingEmailKind } from "@/shared/enums";
import type { IncomingEmailDTO, IncomingKindFilter } from "@/shared/incoming-email";
import { useIncomingEmail, useIncomingEmails } from "./use-incoming-emails";

const PAGE_SIZE = 25;
const ALL_INBOXES = "all";

const KIND_FILTERS: { value: IncomingKindFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reply", label: "Replies" },
  { value: "bounce", label: "Bounces" },
  { value: "auto_reply", label: "Auto-replies" },
  { value: "other", label: "Other" },
];

const KIND_BADGE: Record<IncomingEmailKind, { label: string; className: string }> = {
  reply: {
    label: "Reply",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  bounce: { label: "Bounce", className: "bg-destructive/10 text-destructive" },
  auto_reply: {
    label: "Auto-reply",
    className: "bg-secondary text-secondary-foreground",
  },
  other: {
    label: "Other",
    className: "border bg-transparent text-muted-foreground",
  },
};

export function IncomingEmailsView() {
  const [kind, setKind] = useState<IncomingKindFilter>("all");
  const [inboxId, setInboxId] = useState<string>(ALL_INBOXES);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());

  const emails = useIncomingEmails({
    page,
    limit: PAGE_SIZE,
    kind,
    inboxId: inboxId === ALL_INBOXES ? undefined : inboxId,
    search: debouncedSearch || undefined,
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
  const inboxes = emails.data?.inboxes ?? [];
  const lastChecked = inboxes
    .map((i) => i.checkedAt)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1">
        {KIND_FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={f.value === kind ? "secondary" : "ghost"}
            onClick={() => change(setKind)(f.value)}
          >
            {f.label}
            {emails.data && (
              <span className="text-muted-foreground ml-1 text-xs tabular-nums">
                {emails.data.counts[f.value].toLocaleString()}
              </span>
            )}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            placeholder="Search sender or subject"
            className="pl-8"
            value={search}
            onChange={(e) => change(setSearch)(e.target.value)}
          />
        </div>
        <SimpleSelect
          className="w-64"
          value={inboxId}
          onChange={change(setInboxId)}
          options={[
            { value: ALL_INBOXES, label: "All inboxes" },
            ...inboxes.map((i) => ({ value: i.id, label: i.email })),
          ]}
        />
        <span className="text-muted-foreground ml-auto text-xs">
          {emails.data
            ? inboxes.length === 0
              ? "No inbox is connected to a provider yet."
              : `Inboxes last read ${formatRelative(lastChecked)} · checked every 5 minutes`
            : " "}
        </span>
      </div>

      {emails.data && total === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={debouncedSearch || kind !== "all" ? "No match" : "No emails received yet"}
          description="Emails that arrive in your connected inboxes appear here within about 5 minutes. The worker must be running, and the Microsoft connection that reads the inbox needs the Mail.Read permission."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>From</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Inbox</TableHead>
                <TableHead>Type</TableHead>
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
                    <TableRow
                      key={email.id}
                      className="cursor-pointer"
                      onClick={() => setOpenId(email.id)}
                    >
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDateTime(email.receivedAt)}
                      </TableCell>
                      <TableCell>
                        <Sender email={email} />
                      </TableCell>
                      <TableCell className="max-w-96">
                        <div className="truncate font-medium">
                          {email.subject || "(no subject)"}
                        </div>
                        <div className="text-muted-foreground truncate text-xs">
                          {email.preview || "—"}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{email.inboxEmail}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <KindBadge kind={email.kind} />
                          {email.campaign && (
                            <span className="text-muted-foreground max-w-40 truncate text-xs">
                              {email.campaign.name}
                            </span>
                          )}
                        </div>
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

      <EmailDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function KindBadge({ kind }: { kind: IncomingEmailKind }) {
  const { label, className } = KIND_BADGE[kind];
  return <Badge className={className}>{label}</Badge>;
}

/** Name (or contact name) on top, address below. */
function Sender({ email }: { email: IncomingEmailDTO }) {
  const name = email.contact?.name || email.fromName;
  return (
    <div className="flex flex-col">
      <span className="max-w-56 truncate">{name || email.fromEmail || "—"}</span>
      {name && (
        <span className="text-muted-foreground max-w-56 truncate text-xs">{email.fromEmail}</span>
      )}
    </div>
  );
}

/** The whole email: the new text first, the full email (with quoted earlier emails) on request. */
function EmailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const email = useIncomingEmail(id);
  const [showFull, setShowFull] = useState(false);
  const data = email.data;
  const hasMore = !!data && data.body.trim() !== "" && data.body.trim() !== data.text.trim();

  return (
    <Dialog
      open={!!id}
      onOpenChange={(open) => {
        if (!open) {
          setShowFull(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">
            {data ? data.subject || "(no subject)" : <Skeleton className="h-5 w-64" />}
          </DialogTitle>
          <DialogDescription>
            {data ? (
              <>
                From {data.fromName ? `${data.fromName} <${data.fromEmail}>` : data.fromEmail} to{" "}
                {data.inboxEmail} · {formatDateTime(data.receivedAt)}
              </>
            ) : (
              " "
            )}
          </DialogDescription>
        </DialogHeader>
        {data ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <KindBadge kind={data.kind} />
              {data.campaign && (
                <Link className="underline" href={`/campaigns/${data.campaign.id}`}>
                  Campaign: {data.campaign.name}
                </Link>
              )}
              {data.contact && (
                <span className="text-muted-foreground">
                  Contact: {data.contact.name || data.contact.email}
                </span>
              )}
            </div>
            <pre className="bg-muted/40 max-h-[60vh] overflow-auto rounded-md border p-3 font-sans text-sm whitespace-pre-wrap">
              {(showFull ? data.body : data.text || data.body).trim() || "(empty)"}
            </pre>
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setShowFull((v) => !v)}
              >
                {showFull ? "Show only the new text" : "Show the full email (with quoted text)"}
              </Button>
            )}
          </div>
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}
