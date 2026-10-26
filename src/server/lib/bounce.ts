// Reads bounce reports ("Undeliverable: …" emails from postmaster / MAILER-DAEMON) and replies
// (pure: no database, no I/O). The mailbox tick decides what to do with the result.
import type { ReceivedEmail } from "@/server/providers/types";

export type Bounce = {
  /** Enhanced status code, e.g. "5.7.708". */
  code: string;
  /** With the SMTP reply code when present, e.g. "550 5.7.708". */
  smtp: string;
  /** The line that explains it (shortened). */
  reason: string;
  /** Message-ID of the email that bounced, from the report's copy of the original headers. */
  originalMessageId: string | null;
  /** Addresses mentioned in the report (to match the original when there is no Message-ID). */
  addresses: string[];
};

const BOUNCE_SENDER = /^(postmaster|mailer-daemon|microsoftexchange[0-9a-f]*)@/i;
const BOUNCE_SUBJECT =
  /^(undeliverable|undelivered mail|delivery has failed|delivery status notification \((failure|delay)\)|mail delivery failed|returned mail|failure notice|mail delivery subsystem)/i;
// "550 5.7.708" or "550-5.7.708" or "#550 5.7.708"; otherwise just "5.7.708".
const SMTP_CODE = /\b([45]\d\d)[\s-]+#?([45]\.\d{1,3}\.\d{1,3})\b/;
const STATUS_CODE = /\b([45]\.\d{1,3}\.\d{1,3})\b/;
const MESSAGE_ID = /^\s*Message-ID:\s*(<[^>\s]+>)/im;
const ADDRESS = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** Codes where the SENDER is blocked (whole tenant / IP pool / mailbox) → stop sending and alert. */
export const CRITICAL_BOUNCE_CODES = ["5.7.705", "5.7.708", "5.1.8"];
/** Codes where the RECIPIENT address does not exist → never email it again. */
export const BAD_RECIPIENT_CODES = ["5.1.1", "5.1.10", "5.4.1", "5.1.0", "5.2.1"];

export function isBounceReport(email: Pick<ReceivedEmail, "fromEmail" | "subject">): boolean {
  return BOUNCE_SENDER.test(email.fromEmail) || BOUNCE_SUBJECT.test(email.subject.trim());
}

/** null when the email is not a bounce report (or a delay notice — those are not failures yet). */
export function parseBounce(
  email: Pick<ReceivedEmail, "fromEmail" | "subject" | "body">,
): Bounce | null {
  if (!isBounceReport(email)) return null;
  const body = email.body;
  const smtp = SMTP_CODE.exec(body);
  const status = smtp ? smtp[2] : STATUS_CODE.exec(body)?.[1];
  if (!status || status.startsWith("4.")) return null; // 4.x.x = temporary delay, the server keeps trying

  const codeText = smtp ? `${smtp[1]} ${smtp[2]}` : status;
  const line =
    body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.includes(status)) ?? "";
  return {
    code: status,
    smtp: codeText,
    reason: line.length > 300 ? `${line.slice(0, 297)}...` : line,
    originalMessageId: MESSAGE_ID.exec(body)?.[1] ?? null,
    addresses: [...new Set((body.match(ADDRESS) ?? []).map((a) => a.toLowerCase()))],
  };
}

const AUTO_REPLY =
  /^(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|ooo\b|away from)/i;

/** "Automatic reply: …" / "Out of Office" emails are not real replies. */
export function isAutoReply(email: Pick<ReceivedEmail, "subject">): boolean {
  return AUTO_REPLY.test(email.subject.trim());
}

/** The reply asks us to stop: it starts with "no", "not interested", "unsubscribe", "remove me" or "stop". */
export function isOptOutReply(email: Pick<ReceivedEmail, "subject" | "uniqueBody">): boolean {
  const firstLine =
    email.uniqueBody
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  const optOut =
    /^(no|nope|no thanks|no thank you|not interested|unsubscribe|remove( me)?|stop)\b/i;
  return optOut.test(firstLine) || /^(re:\s*)?unsubscribe\b/i.test(email.subject.trim());
}
