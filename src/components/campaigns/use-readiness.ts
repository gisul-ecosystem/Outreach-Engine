"use client";

import { useMemo } from "react";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import {
  checkCampaignContent,
  checkSenders,
  type ReadinessItem,
  type ReadinessTemplate,
} from "@/shared/readiness";
import { useCampaignReadiness } from "./use-campaigns";

/** Typing pauses this long before the checks run again. */
const LIVE_DELAY_MS = 300;

/**
 * The readiness checks for what is typed right now (re-run ~0.3 s after typing stops), with the
 * database facts from the server, plus the server's setup checks (inboxes, DNS, Mail.Read, test sent).
 */
export function useLiveReadiness(
  campaignId: string | null,
  templates: ReadinessTemplate[],
  isFollowUp: boolean,
) {
  const readiness = useCampaignReadiness(campaignId);
  // A string compares by value, so the delay restarts only when the text really changes.
  const typed = useDebouncedValue(JSON.stringify(templates), LIVE_DELAY_MS);
  const data = readiness.data;
  const content = useMemo<ReadinessItem[]>(() => {
    const versions = JSON.parse(typed) as ReadinessTemplate[];
    const context = data?.context ?? { isFollowUp };
    return [
      ...checkCampaignContent(versions, context),
      ...checkSenders(versions, data?.inboxes ?? []),
    ];
  }, [typed, data, isFollowUp]);
  return { content, setup: data?.setup ?? [], readiness };
}
