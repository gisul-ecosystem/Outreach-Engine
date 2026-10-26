// What spam filters punish in an email, as small detectors (pure: no database, no I/O).
// Shared by the server (src/server/lib/content-check.ts, Start/Resume) and the browser
// (the live "Outlook readiness" panel), so both always apply exactly the same rules.

/** Phrases that make filters treat an email as marketing spam. Matched as whole words, any case. */
export const SPAM_PHRASES = [
  "free",
  "guaranteed",
  "guarantee",
  "100%",
  "act now",
  "risk-free",
  "no cost",
  "click here",
  "limited time",
  "urgent",
  "winner",
  "cash",
  "buy now",
  "order now",
] as const;

/** A plain way to say the same thing (shown as "Replace with …"). */
export const SPAM_REPLACEMENTS: Record<(typeof SPAM_PHRASES)[number], string> = {
  free: "at no charge",
  guaranteed: "promised",
  guarantee: "promise",
  "100%": "fully",
  "act now": "when you have a moment",
  "risk-free": "with no commitment",
  "no cost": "included",
  "click here": "here is the link",
  "limited time": "this month",
  urgent: "time-sensitive",
  winner: "chosen",
  cash: "money",
  "buy now": "get started",
  "order now": "get started",
};

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SPAM = SPAM_PHRASES.map((phrase) => ({
  phrase,
  // "100%" ends in a symbol, so \b would not match after it.
  pattern: new RegExp(`(^|[^\\w])(${escapeRegex(phrase)})(?=$|[^\\w])`, "i"),
}));
/** Words of 5+ capital letters, like URGENT or AMAZING (short acronyms like GPU, GST, A100 are fine). */
const SHOUTING = /\b[A-Z]{5,}\b/g;
export const VARIABLE_PATTERN = /\{\{[^{}]*\}\}/g;
export const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>)]+/gi;
export const OPT_OUT_PATTERN = /won['’]?t email|unsubscribe|reply ['"“]?no['"”]?|opt[ -]?out/i;

export type TemplateText = {
  subjectTemplate: string;
  bodyTemplate: string;
  bodyHtml?: string | null;
};

/** HTML → its visible text (tags removed). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

/** What the reader sees (subject, text, HTML without tags); {{variables}} are not checked. */
export function visibleText(template: TemplateText): string {
  return `${template.subjectTemplate}\n${template.bodyTemplate}\n${htmlToText(template.bodyHtml ?? "")}`.replace(
    VARIABLE_PATTERN,
    " ",
  );
}

/** Spam phrases found in the text, with the exact spelling used (e.g. "FREE"). */
export function findSpamPhrases(text: string): { phrase: string; found: string }[] {
  return SPAM.flatMap(({ phrase, pattern }) => {
    const match = pattern.exec(text);
    return match ? [{ phrase, found: match[2] }] : [];
  });
}

export const findShouting = (text: string) => [...new Set(text.match(SHOUTING) ?? [])];
export const hasDoubleBang = (text: string) => /!{2,}/.test(text);
export const hasImage = (html: string) => /<img\b/i.test(html);
export const hasActiveContent = (html: string) =>
  /<(form|script|iframe|video|object)\b/i.test(html);

/** Links in the email, counted once each (by address without "www." and trailing "/"). */
export function distinctLinks(template: Pick<TemplateText, "bodyTemplate" | "bodyHtml">): string[] {
  const all = `${template.bodyTemplate}\n${template.bodyHtml ?? ""}`.match(URL_PATTERN) ?? [];
  return [
    ...new Set(
      all.map((u) =>
        u
          .toLowerCase()
          .replace(/^https?:\/\/(www\.)?/, "")
          .replace(/\/+$/, ""),
      ),
    ),
  ];
}
