"use client";

import {
  LinkIcon,
  MailIcon,
  MousePointerClickIcon,
  ReplyIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatRelative } from "@/lib/client/format";
import { VerdictBadge } from "@/components/tracking/verdict-badge";
import { useContactLinks, useContactTimeline } from "@/components/tracking/use-tracking";
import type { ContactDTO } from "@/shared/contact";
import type { TimelineItemDTO } from "@/shared/tracking";
import { ContactStatusBadge } from "./contact-status-badge";

/** Slide-out panel: what happened with one person — emails, replies, link clicks. */
export function ContactPanel({
  contact,
  onClose,
  onCopyLink,
}: {
  contact: ContactDTO | null;
  onClose: () => void;
  onCopyLink: (contact: ContactDTO) => void;
}) {
  const links = useContactLinks(contact?.id ?? null);
  const timeline = useContactTimeline(contact?.id ?? null);
  const e = contact?.engagement;
  const name = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") : "";

  return (
    <Sheet open={!!contact} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg data-[side=right]:sm:max-w-lg">
        {contact && e && (
          <>
            <SheetHeader>
              <SheetTitle>{name || contact.email}</SheetTitle>
              <SheetDescription>
                {contact.email}
                {contact.company ? ` · ${contact.company}` : ""}
              </SheetDescription>
              <div className="flex items-center gap-2">
                <ContactStatusBadge status={contact.status} suppressed={contact.suppressed} />
                <Button size="sm" variant="outline" onClick={() => onCopyLink(contact)}>
                  <LinkIcon />
                  Copy link
                </Button>
              </div>
            </SheetHeader>

            <div className="grid grid-cols-3 gap-2 px-4">
              <Stat label="Emailed" value={e.emailsSent} when={e.lastEmailedAt} />
              <Stat label="Replied" value={e.replyCount} when={e.lastRepliedAt} />
              <Stat
                label="Real clicks"
                value={e.realClickCount}
                when={e.lastClickedAt}
                note={
                  e.clickCount > e.realClickCount
                    ? `+${e.clickCount - e.realClickCount} by bots`
                    : undefined
                }
              />
            </div>

            <section className="grid gap-2 px-4">
              <h3 className="text-sm font-medium">Links</h3>
              {links.isPending ? (
                <Skeleton className="h-10 w-full" />
              ) : links.data?.length ? (
                links.data.map((link) => (
                  <div key={link.id} className="rounded-md border p-2 text-xs">
                    <div className="font-mono break-all">{link.url}</div>
                    <div className="text-muted-foreground">
                      → {link.destinationUrl} · sent in {link.sentCount} email(s) ·{" "}
                      {link.realClickCount} real / {link.clickCount} total opens
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No link yet. Use &quot;Copy link&quot; to make one.
                </p>
              )}
            </section>

            <section className="grid gap-2 px-4 pb-6">
              <h3 className="text-sm font-medium">Timeline</h3>
              {timeline.isPending ? (
                <Skeleton className="h-24 w-full" />
              ) : timeline.data?.length ? (
                <ol className="grid gap-3">
                  {timeline.data.map((item, i) => (
                    <TimelineRow key={`${item.type}-${item.at}-${i}`} item={item} />
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing yet.</p>
              )}
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({
  label,
  value,
  when,
  note,
}: {
  label: string;
  value: number;
  when: string | null;
  note?: string;
}) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{when ? formatRelative(when) : "—"}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

function TimelineRow({ item }: { item: TimelineItemDTO }) {
  const time = <span className="text-xs text-muted-foreground">{formatDateTime(item.at)}</span>;
  if (item.type === "sent") {
    return (
      <li className="flex gap-2">
        <MailIcon className="mt-0.5 size-4 shrink-0 text-sky-600" />
        <div className="grid gap-0.5">
          <span className="text-sm">
            Emailed: <span className="font-medium">{item.subject || "(no subject)"}</span>
          </span>
          <span className="text-xs text-muted-foreground">
            from {item.inboxEmail} · {item.source === "manual" ? "by hand" : "by the engine"}
          </span>
          {item.wrongLink && (
            <Badge variant="destructive" className="w-fit gap-1">
              <TriangleAlertIcon className="size-3" />
              Contains someone else&apos;s link
            </Badge>
          )}
          {time}
        </div>
      </li>
    );
  }
  if (item.type === "replied") {
    return (
      <li className="flex gap-2">
        <ReplyIcon className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        <div className="grid gap-0.5">
          <span className="text-sm">
            Replied{item.from ? ` (${item.from})` : ""} to{" "}
            <span className="font-medium">{item.subject || "(no subject)"}</span>
          </span>
          {time}
        </div>
      </li>
    );
  }
  return (
    <li className="flex gap-2">
      <MousePointerClickIcon className="mt-0.5 size-4 shrink-0 text-teal-600" />
      <div className="grid gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm">
          Opened the link <VerdictBadge verdict={item.verdict} />
        </span>
        <span className="text-xs text-muted-foreground">{item.reasons.join(" ")}</span>
        <span className="text-xs break-all text-muted-foreground">→ {item.destinationUrl}</span>
        {time}
      </div>
    </li>
  );
}
