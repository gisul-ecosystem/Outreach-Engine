// Was a click made by a real person, or by a security scanner / bot? (pure: no database, no I/O)
//
// Company email security (Microsoft Defender Safe Links, Mimecast, Proofpoint, Barracuda, Gmail) often
// opens every link in an email seconds after it arrives, before the person reads it. Those are not clicks.
//   bot        → certain: not a person (HEAD request, a script, a known scanner)
//   suspicious → "maybe a bot" (too fast after sending, a burst, missing browser details)
//   click      → looks like a real person
// A "bot" reason always wins over a "suspicious" one. Every reason has a plain-English sentence for the UI.
// Phase 11 can later upgrade a click to "real person" when racko.ai confirms the visit.
import type { ClickVerdict } from "@/shared/enums";
import { knownScanner } from "./scanners";

/** Opened this soon after the email was sent → probably a scanner. */
export const TOO_FAST_SECONDS = 60;
/** This many opens of the same link within BURST_SECONDS → a scanner. */
export const BURST_COUNT = 3;
export const BURST_SECONDS = 10;
/** The same visitor opened the links of this many OTHER people within CROSS_CONTACT_SECONDS → a company scanner. */
export const CROSS_CONTACT_COUNT = 2;
export const CROSS_CONTACT_SECONDS = 120;

export type ClickSignals = {
  method: string;
  userAgent: string;
  /** The browser sent an Accept-Language header (its language) — real browsers always do. */
  hasAcceptLanguage: boolean;
  /** The browser sent Sec-Fetch-* headers — Chrome, Edge and Firefox always do on a normal visit. */
  hasSecFetch: boolean;
  /** Seconds between the email being sent and this click; null = we don't know when it was sent. */
  secondsSinceSent: number | null;
  /** Opens of this same link in the last BURST_SECONDS, this one included. */
  recentSameLink: number;
  /** Other people's links opened by the same visitor in the last CROSS_CONTACT_SECONDS. */
  otherContactsSameVisitor: number;
};

export type ClickReason = { code: string; text: string };
export type ClickJudgement = { verdict: ClickVerdict; reasons: ClickReason[] };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function classifyClick(s: ClickSignals): ClickJudgement {
  const bot: ClickReason[] = [];
  const suspicious: ClickReason[] = [];
  const ua = s.userAgent.trim();

  if (s.method.toUpperCase() === "HEAD") {
    bot.push({
      code: "head-request",
      text: "Checked by software, not opened in a browser (a HEAD request).",
    });
  }
  if (!ua) {
    bot.push({ code: "no-user-agent", text: "No browser name was sent: an automated tool." });
  } else {
    const scanner = knownScanner(ua);
    if (scanner) {
      bot.push({ code: "known-scanner", text: `Known scanner or link preview: ${scanner}.` });
    } else if (!ua.startsWith("Mozilla/")) {
      bot.push({
        code: "not-a-browser",
        text: "Not a web browser (every browser's name starts with Mozilla/).",
      });
    }
  }

  if (
    s.secondsSinceSent !== null &&
    s.secondsSinceSent >= 0 &&
    s.secondsSinceSent < TOO_FAST_SECONDS
  ) {
    suspicious.push({
      code: "too-fast",
      text: `Probably a security scanner: opened ${plural(Math.round(s.secondsSinceSent), "second")} after sending.`,
    });
  }
  if (s.recentSameLink >= BURST_COUNT) {
    suspicious.push({
      code: "burst",
      text: `Opened ${plural(s.recentSameLink, "time")} within ${BURST_SECONDS} seconds: typical of a scanner.`,
    });
  }
  if (s.otherContactsSameVisitor >= CROSS_CONTACT_COUNT) {
    suspicious.push({
      code: "many-people",
      text: `The same visitor also opened ${plural(s.otherContactsSameVisitor, "other person")}'s links within ${CROSS_CONTACT_SECONDS / 60} minutes: probably a company scanner.`,
    });
  }
  if (!s.hasAcceptLanguage) {
    suspicious.push({
      code: "no-language",
      text: "The browser did not send its language, which real browsers always do.",
    });
  }
  if (!s.hasSecFetch && /(Chrome|Edg|Firefox)\//.test(ua) && !bot.length) {
    suspicious.push({
      code: "no-sec-fetch",
      text: "Pretends to be Chrome/Edge/Firefox but is missing details those browsers always send.",
    });
  }

  if (bot.length) return { verdict: "bot", reasons: [...bot, ...suspicious] };
  if (suspicious.length) return { verdict: "suspicious", reasons: suspicious };
  return {
    verdict: "click",
    reasons: [{ code: "looks-human", text: "Looks like a real person." }],
  };
}
