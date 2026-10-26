"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useTrackingConfig } from "./use-tracking";

/** Shown while TRACKING_BASE_URL is localhost or http: links can't be opened by the people we email. */
export function LocalLinksBanner() {
  const config = useTrackingConfig();
  if (!config.data?.isLocal) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
      <p>
        Your tracking links only work on this computer right now ({config.data.baseUrl}). People you
        email can&apos;t open them until the engine is online — see README, &quot;Click
        tracking&quot;. Don&apos;t put these links in real emails yet.
      </p>
    </div>
  );
}
