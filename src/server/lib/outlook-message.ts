// Builds the JSON that Microsoft Graph gets in "outlook" format (pure: no database, no I/O).
//
// In this format Microsoft (Exchange) builds the real email itself — Message-ID, Date, MIME-Version,
// the plain-text version and the <html> wrapper — exactly as it does for an email typed in Outlook.
// So nothing here sets those headers, a Reply-To or List-Unsubscribe: the opt-out line stays in the body.
// Graph only accepts custom headers whose names start with "x-", so In-Reply-To / References cannot be
// set: a follow-up is sent with Graph's `reply` action on the first email instead (Exchange threads it).
import type { SendInput } from "@/server/providers/types";
import { textToHtml } from "./mime";

type Recipient = { emailAddress: { address: string } };

/** Graph's sendMail body: POST /users/{mailbox}/sendMail with Content-Type: application/json. */
export type OutlookSendMailBody = {
  message: {
    subject: string;
    body: { contentType: "HTML"; content: string };
    toRecipients: Recipient[];
  };
  saveToSentItems: true;
};

/** Graph's reply body: POST /users/{mailbox}/messages/{id}/reply. */
export type OutlookReplyBody = {
  /**
   * The recipient is always set: replying to an email WE sent would otherwise go back to ourselves
   * (Graph replies to the original's `from`). The subject is not set — Exchange makes it "RE: …".
   */
  message: { toRecipients: Recipient[] };
  /** The new text, put above the quoted first email (Graph allows `comment` OR message.body, not both). */
  comment: string;
};

/** The HTML body: the campaign's own HTML version, otherwise the text laid out like Outlook does. */
export function outlookHtml(input: Pick<SendInput, "text" | "html">): string {
  return input.html ?? textToHtml(input.text, { style: "outlook" });
}

const recipients = (to: string): Recipient[] => [{ emailAddress: { address: to } }];

export function outlookSendMailBody(input: SendInput): OutlookSendMailBody {
  return {
    message: {
      // A subject is one line (a line break would break the header Microsoft writes).
      subject: input.subject.replace(/[\r\n]+/g, " ").trim(),
      body: { contentType: "HTML", content: outlookHtml(input) },
      toRecipients: recipients(input.to),
    },
    saveToSentItems: true,
  };
}

export function outlookReplyBody(input: SendInput): OutlookReplyBody {
  return { message: { toRecipients: recipients(input.to) }, comment: outlookHtml(input) };
}
