"use client";

import {
  ActivityIcon,
  AlertTriangleIcon,
  BanIcon,
  GlobeIcon,
  MailIcon,
  MegaphoneIcon,
  RotateCwIcon,
  SendIcon,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatAgo } from "@/lib/client/format";
import { useNow } from "@/lib/client/use-now";
import { cn } from "@/lib/utils";
import type { ActivityDTO } from "@/shared/dashboard";

function look(type: string): { icon: LucideIcon; className: string } {
  if (type === "message.sent") return { icon: SendIcon, className: "text-emerald-600" };
  if (type === "message.retry") return { icon: RotateCwIcon, className: "text-amber-600" };
  if (type === "message.failed" || type === "message.unknown_state" || type === "provider.error") {
    return { icon: AlertTriangleIcon, className: "text-red-600" };
  }
  if (type === "inbox.auto_paused") return { icon: AlertTriangleIcon, className: "text-amber-600" };
  if (type.startsWith("suppression")) return { icon: BanIcon, className: "text-muted-foreground" };
  if (type.startsWith("campaign")) return { icon: MegaphoneIcon, className: "text-violet-600" };
  if (type.startsWith("inbox")) return { icon: MailIcon, className: "text-sky-600" };
  if (type.startsWith("domain")) return { icon: GlobeIcon, className: "text-sky-600" };
  return { icon: ActivityIcon, className: "text-muted-foreground" };
}

export function ActivityFeed({ events }: { events: ActivityDTO[] | undefined }) {
  const now = useNow();

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ActivityIcon className="size-4 text-muted-foreground" />
          Recent activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!events ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : events.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
            {events.map((event) => {
              const { icon: Icon, className } = look(event.type);
              return (
                <li key={event.id} className="flex gap-3">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", className)} />
                  <div className="min-w-0">
                    <p className="text-sm leading-snug break-words">
                      {event.message || event.type}
                    </p>
                    <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                      {formatAgo(event.createdAt, now)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
