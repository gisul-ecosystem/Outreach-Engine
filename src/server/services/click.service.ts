// What happens when someone opens https://go.racko.ai/r/<token>:
//   1. find whose link it is, 2. judge the click (real person / maybe a bot / bot) and save it,
//   3. hand back where to send the browser.
// resolveClick() NEVER throws and never takes long: an unknown token, a database error or a slow
// database all end at TRACKING_FALLBACK_URL, so the person never sees an error page.
import type { Types } from "mongoose";
import { getEnv } from "@/server/config/env";
import { connectDB } from "@/server/db/connect";
import { LinkClick, TrackedEmail, TrackedLink } from "@/server/db/models";
import { createLogger } from "@/server/lib/logger";
import {
  BURST_SECONDS,
  classifyClick,
  CROSS_CONTACT_SECONDS,
  type ClickSignals,
} from "@/server/tracking/classify-click";
import { clientIp, hashIp } from "@/server/tracking/client-ip";
import { allowedDestination } from "@/server/tracking/destination";
import { allowClick } from "@/server/tracking/rate-limit";
import { isTokenFormat } from "@/server/tracking/token";
import { refreshEngagement, refreshLinkCounters } from "@/server/services/engagement.service";

const log = createLogger("clicks");

/** Longest the redirect waits for the database before sending the person on anyway. */
export const CLICK_TIMEOUT_MS = 1500;
const MAX_USER_AGENT = 300;

export type ClickRequest = { token: string; method: string; headers: Headers; now?: Date };

/** Where to send the browser. Never throws. */
export async function resolveClick(request: ClickRequest): Promise<string> {
  const env = getEnv();
  const fallback = env.TRACKING_FALLBACK_URL;
  if (!isTokenFormat(request.token)) return fallback;

  // Known as soon as the link is found: if saving the click is then slow or fails, still go there.
  let destination: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => {
      log.warn("saving a click took too long — redirected without waiting");
      resolve(destination ?? fallback);
    }, CLICK_TIMEOUT_MS);
  });

  const work = (async () => {
    await connectDB();
    const link = await TrackedLink.findOne({ token: request.token, deletedAt: null }).lean();
    if (!link) return fallback;
    // Checked again at every click: a link whose destination is no longer allowed is never followed.
    destination = allowedDestination(link.destinationUrl, env.TRACKING_ALLOWED_HOSTS);
    if (!destination) {
      log.warn(`link ${link._id} points to a site that is not allowed — sent to the fallback`);
      return fallback;
    }
    await recordClick(link, request);
    return destination;
  })().catch((err: unknown) => {
    log.error("click not saved", err instanceof Error ? err.message : err);
    return destination ?? fallback;
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type LinkRow = {
  _id: Types.ObjectId;
  token: string;
  contactId: Types.ObjectId;
  lastSentAt?: Date | null;
};

async function recordClick(link: LinkRow, request: ClickRequest) {
  const env = getEnv();
  const now = request.now ?? new Date();
  const ip = clientIp(request.headers, env.TRUST_PROXY);
  const ipHash = ip && env.TRACKING_IP_SECRET ? hashIp(ip, env.TRACKING_IP_SECRET) : null;
  if (!allowClick(ipHash ?? `token:${link.token}`, now.getTime())) return; // over the limit: don't save

  const [recentSameLink, otherContacts] = await Promise.all([
    LinkClick.countDocuments({
      linkId: link._id,
      at: { $gte: new Date(now.getTime() - BURST_SECONDS * 1000) },
    }),
    ipHash
      ? LinkClick.distinct("contactId", {
          ipHash,
          contactId: { $ne: link.contactId },
          at: { $gte: new Date(now.getTime() - CROSS_CONTACT_SECONDS * 1000) },
        })
      : Promise.resolve([]),
  ]);
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, MAX_USER_AGENT);
  const sentAt = link.lastSentAt && link.lastSentAt <= now ? link.lastSentAt : null;
  const signals = {
    hasAcceptLanguage: !!request.headers.get("accept-language")?.trim(),
    hasSecFetch: [...request.headers.keys()].some((h) => h.toLowerCase().startsWith("sec-fetch-")),
    recentSameLink: recentSameLink + 1,
    otherContactsSameVisitor: otherContacts.length,
  };
  const secondsSinceSent = sentAt ? (now.getTime() - sentAt.getTime()) / 1000 : null;
  const judgement = classifyClick({
    method: request.method,
    userAgent,
    secondsSinceSent,
    ...signals,
  });

  await LinkClick.create({
    linkId: link._id,
    token: link.token,
    contactId: link.contactId,
    at: now,
    method: request.method.toUpperCase(),
    userAgent,
    ipHash,
    verdict: judgement.verdict,
    reasons: judgement.reasons.map((r) => r.text),
    reasonCodes: judgement.reasons.map((r) => r.code),
    signals,
    secondsSinceSent,
  });
  const real = judgement.verdict === "click";
  await TrackedLink.updateOne(
    { _id: link._id },
    { $inc: { clickCount: 1, realClickCount: real ? 1 : 0 }, $max: { lastClickAt: now } },
  );
  if (real) {
    await TrackedLink.updateOne(
      { _id: link._id, firstRealClickAt: null },
      { $set: { firstRealClickAt: now } },
    );
  }
  // The contact's summary is updated after the person has been sent on (not awaited).
  void refreshEngagement([link.contactId]).catch((err: unknown) =>
    log.error("engagement not updated", err instanceof Error ? err.message : err),
  );
}

/**
 * Judges a link's clicks again — called when we learn (from Sent Items) when the link was emailed:
 * a scanner that opened it seconds after sending was saved before we knew the send time.
 */
export async function reclassifyLinkClicks(linkIds: Types.ObjectId[]): Promise<number> {
  if (linkIds.length === 0) return 0;
  const links = await TrackedLink.find({ _id: { $in: linkIds } })
    .select("sentEmailIds contactId")
    .lean();
  let changed = 0;
  for (const link of links) {
    const sends = (
      await TrackedEmail.find({ _id: { $in: link.sentEmailIds } })
        .select("sentAt")
        .lean()
    )
      .map((e) => e.sentAt.getTime())
      .sort((a, b) => a - b);
    const clicks = await LinkClick.find({ linkId: link._id }).lean();
    for (const click of clicks) {
      const at = click.at.getTime();
      const lastSend = sends.filter((t) => t <= at).at(-1);
      const secondsSinceSent = lastSend === undefined ? null : (at - lastSend) / 1000;
      const signals: ClickSignals = {
        method: click.method,
        userAgent: click.userAgent ?? "",
        hasAcceptLanguage: click.signals?.hasAcceptLanguage ?? false,
        hasSecFetch: click.signals?.hasSecFetch ?? false,
        recentSameLink: click.signals?.recentSameLink ?? 1,
        otherContactsSameVisitor: click.signals?.otherContactsSameVisitor ?? 0,
        secondsSinceSent,
      };
      const judgement = classifyClick(signals);
      const codes = judgement.reasons.map((r) => r.code);
      if (
        judgement.verdict === click.verdict &&
        codes.join() === (click.reasonCodes ?? []).join() &&
        secondsSinceSent === (click.secondsSinceSent ?? null)
      ) {
        continue;
      }
      await LinkClick.updateOne(
        { _id: click._id },
        {
          $set: {
            verdict: judgement.verdict,
            reasons: judgement.reasons.map((r) => r.text),
            reasonCodes: codes,
            secondsSinceSent,
          },
        },
      );
      changed++;
    }
  }
  await refreshLinkCounters(linkIds);
  await refreshEngagement(links.map((l) => l.contactId));
  return changed;
}
