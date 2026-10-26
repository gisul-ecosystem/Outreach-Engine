// Builds the raw email (MIME) that is handed to the provider. Pure: no database, no I/O.
//
// Every email is multipart/alternative — a plain-text part AND an HTML part — with the headers a normal
// mail program adds (Message-ID, Date, Reply-To, MIME-Version, UTF-8). Plain-text-only email with bare
// headers looks machine-made to spam filters (this is what Outlook bounced with 5.7.708).
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import type { SendInput } from "@/server/providers/types";
import { escapeHtml } from "./template";

const CRLF = "\r\n";
const MAX_LINE = 76;

export type MimeInput = {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
  date?: Date;
  replyTo?: string;
  /** e.g. "<mailto:me@x.com?subject=unsubscribe>" */
  listUnsubscribe?: string;
  /** Message-ID of the email this one answers (follow-ups stay in the same thread). */
  inReplyTo?: string;
};

/** A new unique Message-ID like <3f2a…@example.com> (the sender's domain on the right). */
export function newMessageId(from: string): string {
  const domain = from.slice(from.lastIndexOf("@") + 1) || "localhost";
  return `<${randomUUID()}@${domain}>`;
}

/** Header values must be one line: a line break inside a header would let text add new headers. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

const isAscii = (value: string) => /^[\x00-\x7F]*$/.test(value);

/** RFC 2047: non-ASCII header text as =?UTF-8?B?…?= words (split on whole characters, ≤ 45 bytes each). */
export function encodeHeader(value: string): string {
  const clean = oneLine(value);
  if (isAscii(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const char of clean) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += char;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString("base64")}?=`).join(`${CRLF} `);
}

/** "Name from Company" <name@example.com> — or just <address> without a name. */
export function formatAddress(address: string, name?: string): string {
  const email = oneLine(address);
  const display = name ? oneLine(name) : "";
  if (!display) return `<${email}>`;
  if (!isAscii(display)) return `${encodeHeader(display)} <${email}>`;
  return `"${display.replace(/(["\\])/g, "\\$1")}" <${email}>`;
}

/** Quoted-printable (RFC 2045) with CRLF line ends and soft breaks so no line is longer than 76. */
export function encodeQuotedPrintable(text: string): string {
  const lines = text.replace(/\r\n|\r/g, "\n").split("\n");
  return lines
    .map((line) => {
      const bytes = Buffer.from(line, "utf8");
      const tokens: string[] = [];
      bytes.forEach((byte, i) => {
        const isLast = i === bytes.length - 1;
        const printable = byte >= 33 && byte <= 126 && byte !== 61; // 61 = "="
        // A space or tab at the end of a line would be removed in transit, so it is encoded.
        const space = (byte === 32 || byte === 9) && !isLast;
        tokens.push(
          printable || space
            ? String.fromCharCode(byte)
            : `=${byte.toString(16).toUpperCase().padStart(2, "0")}`,
        );
      });
      const out: string[] = [];
      let current = "";
      for (const token of tokens) {
        if (current.length + token.length > MAX_LINE - 1) {
          out.push(`${current}=`);
          current = "";
        }
        current += token;
      }
      out.push(current);
      return out.join(CRLF);
    })
    .join(CRLF);
}

const HTML_STYLE =
  "font-family: Calibri, Arial, sans-serif; font-size: 15px; color: #222; line-height: 1.5;";
const OPT_OUT_STYLE = "font-size: 12px; color: #888;";
/** What new Outlook / Outlook on the web uses for a typed email. */
export const OUTLOOK_HTML_STYLE =
  "font-family: Aptos, Calibri, Helvetica, sans-serif; font-size: 12pt; color: rgb(0, 0, 0);";
const OUTLOOK_PARAGRAPH_STYLE = "margin: 0 0 12pt 0;";
/** The "reply no and I won't email you again" line is shown small and grey. */
const OPT_OUT = /won['’]?t email|unsubscribe|reply ['"“]?no['"”]?/i;
const LIST_ITEM = /^\s*[-•*]\s+/;

/**
 * Turns a plain-text email into simple HTML (used when a campaign has no HTML version):
 * blank lines → paragraphs, "- item" lines → a list, the opt-out line in small grey text.
 * Links are NOT added: fewer links look less like marketing email.
 *
 * `style: "outlook"` makes it look like an email typed in Outlook: Aptos/Calibri 12pt in black,
 * plain <p> paragraphs and every line (also the opt-out line) in the same style. No <html> wrapper:
 * Microsoft adds that and makes the plain-text version itself.
 */
export function textToHtml(text: string, options: { style?: "engine" | "outlook" } = {}): string {
  if (options.style === "outlook") {
    const paragraphs = text
      .replace(/\r\n|\r/g, "\n")
      .trim()
      .split(/\n\s*\n/)
      .map(
        (p) =>
          `<p style="${OUTLOOK_PARAGRAPH_STYLE}">${p.split("\n").map(escapeHtml).join("<br>")}</p>`,
      );
    return `<div style="${OUTLOOK_HTML_STYLE}">\n${paragraphs.join("\n")}\n</div>`;
  }
  const paragraphs = text
    .replace(/\r\n|\r/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  const blocks = paragraphs.map((paragraph, index) => {
    const lines = paragraph.split("\n");
    if (lines.every((line) => LIST_ITEM.test(line))) {
      const items = lines.map((line) => `<li>${escapeHtml(line.replace(LIST_ITEM, ""))}</li>`);
      return `<ul>${items.join("")}</ul>`;
    }
    const isOptOut =
      index === paragraphs.length - 1 && paragraphs.length > 1 && OPT_OUT.test(paragraph);
    const body = lines.map(escapeHtml).join("<br>\n");
    return isOptOut ? `<p style="${OPT_OUT_STYLE}">${body}</p>` : `<p>${body}</p>`;
  });
  return `<div style="${HTML_STYLE}">\n${blocks.join("\n")}\n</div>`;
}

/** Wraps an HTML fragment in a minimal document that declares UTF-8. */
function htmlDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html;
  return `<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head><body>\n${html}\n</body></html>`;
}

/**
 * The raw email for a provider send. Fills in what the caller left out: a Message-ID and an HTML part
 * made from the text. Used by the providers AND by the preview script, so the preview is exactly what is sent.
 */
export function mimeForSend(input: SendInput, date?: Date): { mime: string; messageId: string } {
  const messageId = input.messageId ?? newMessageId(input.from);
  const mime = buildMimeMessage({
    from: input.from,
    fromName: input.fromName,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html ?? textToHtml(input.text),
    messageId,
    date,
    inReplyTo: input.inReplyTo,
    listUnsubscribe: input.listUnsubscribe,
  });
  return { mime, messageId };
}

/** The complete raw email (headers + text part + HTML part), ready to send. */
export function buildMimeMessage(input: MimeInput): string {
  const boundary = `----=_Part_${randomUUID().replace(/-/g, "")}`;
  const date = DateTime.fromJSDate(input.date ?? new Date())
    .toUTC()
    .toRFC2822();
  const headers = [
    `From: ${formatAddress(input.from, input.fromName)}`,
    `To: ${formatAddress(input.to)}`,
    `Subject: ${encodeHeader(input.subject)}`,
    `Date: ${date}`,
    `Message-ID: ${oneLine(input.messageId)}`,
    `Reply-To: ${formatAddress(input.replyTo ?? input.from, input.replyTo ? undefined : input.fromName)}`,
  ];
  if (input.inReplyTo) {
    headers.push(
      `In-Reply-To: ${oneLine(input.inReplyTo)}`,
      `References: ${oneLine(input.inReplyTo)}`,
    );
  }
  if (input.listUnsubscribe) headers.push(`List-Unsubscribe: ${oneLine(input.listUnsubscribe)}`);
  headers.push("MIME-Version: 1.0", `Content-Type: multipart/alternative; boundary="${boundary}"`);

  const part = (type: string, content: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${type}; charset=UTF-8`,
      "Content-Transfer-Encoding: quoted-printable",
      "",
      encodeQuotedPrintable(content),
    ].join(CRLF);

  return [
    ...headers,
    "",
    part("text/plain", input.text),
    part("text/html", htmlDocument(input.html)),
    `--${boundary}--`,
    "",
  ].join(CRLF);
}
