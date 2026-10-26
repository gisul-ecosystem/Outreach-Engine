// Checks an email template for things spam filters punish (pure: no database, no I/O).
// `problems` block Start/Resume; `warnings` are shown in the preview only.
// The detectors live in src/shared/content-rules.ts so the browser's readiness panel uses the same rules.
import {
  distinctLinks,
  findShouting,
  findSpamPhrases,
  hasActiveContent,
  hasDoubleBang,
  hasImage,
  OPT_OUT_PATTERN,
  visibleText,
} from "@/shared/content-rules";
import type { EmailTemplate } from "./template";

export { SPAM_PHRASES } from "@/shared/content-rules";

export type ContentCheck = { problems: string[]; warnings: string[] };

export function checkEmailContent(template: EmailTemplate, label = "The email"): ContentCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  const html = template.bodyHtml ?? "";
  const visible = visibleText(template);

  const spam = findSpamPhrases(visible).map((s) => `"${s.phrase}"`);
  if (spam.length) problems.push(`${label} uses spam-trigger words: ${spam.join(", ")}`);
  if (hasDoubleBang(visible))
    problems.push(`${label} uses "!!" — use at most one exclamation mark`);
  const caps = findShouting(visible);
  if (caps.length) problems.push(`${label} has words in ALL CAPS: ${caps.join(", ")}`);
  if (hasImage(html)) {
    problems.push(`${label} has an image — images and tracking pixels hurt delivery; remove it`);
  }
  if (hasActiveContent(html)) {
    problems.push(`${label} has a form, script or embedded content; remove it`);
  }
  const links = distinctLinks(template);
  if (links.length > 1) {
    problems.push(
      `${label} has ${links.length} different links — keep at most one (${links.join(", ")})`,
    );
  }
  if (!OPT_OUT_PATTERN.test(template.bodyTemplate)) {
    warnings.push(
      `${label} has no opt-out line (e.g. "Not relevant? Just reply 'no' and I won't email again.")`,
    );
  }
  if (template.bodyHtml && !OPT_OUT_PATTERN.test(html)) {
    warnings.push(`${label}'s HTML version has no opt-out line`);
  }
  return { problems, warnings };
}
