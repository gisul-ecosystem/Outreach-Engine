// ZeptoMail (Zoho's email-sending API): one HTTPS call per email, authorised with a Mail Agent's
// Send Mail token. It can only SEND — it cannot list or read mailboxes — so bounce / reply detection
// and Sent Items tracking find nothing for inboxes that use it.
import { textToHtml } from "@/server/lib/mime";
import type { ZeptoRegion } from "@/shared/enums";
import {
  ProviderError,
  type CheckResult,
  type EmailProvider,
  type MailboxInfo,
  type ReceivedEmail,
  type SendInput,
  type SendResult,
} from "./types";

const REQUEST_TIMEOUT_MS = 30_000;

export type ZeptoCredentials = { token: string; region: ZeptoRegion };

/** The send endpoint of the account's data centre (an account only works with its own region). */
export function zeptoApiUrl(region: ZeptoRegion): string {
  return `https://api.zeptomail.${region}/v1.1/email`;
}

type ZeptoErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: { code?: string; message?: string; target?: string }[];
  };
};

/** Removes anything that looks like the token from a message before it is stored or logged. */
function scrub(message: string, token: string) {
  return token ? message.split(token).join("[token]") : message;
}

export class ZeptoMailProvider implements EmailProvider {
  constructor(private readonly creds: ZeptoCredentials) {}

  private get host() {
    return `api.zeptomail.${this.creds.region}`;
  }

  private async post(body: unknown): Promise<Response> {
    try {
      return await fetch(zeptoApiUrl(this.creds.region), {
        method: "POST",
        headers: {
          Authorization: `Zoho-enczapikey ${this.creds.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // No answer in time: the request may have reached ZeptoMail and the email may have left.
      // A plain Error (not ProviderError) makes the sender mark it UNKNOWN_STATE — never re-sent.
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new Error(
          `ZeptoMail did not answer within ${REQUEST_TIMEOUT_MS / 1000} s — the email may or may not have been sent`,
        );
      }
      throw new ProviderError(
        "transient",
        "NETWORK",
        `Could not reach ZeptoMail (${this.host}) — network error`,
      );
    }
  }

  /** ZeptoMail error response → transient / permanent / auth (BUILD_PLAN section 6). */
  static async errorFromResponse(response: Response, token = ""): Promise<ProviderError> {
    const body = (await response.json().catch(() => null)) as ZeptoErrorBody | null;
    const detail = body?.error?.details?.[0];
    const code = detail?.code ?? body?.error?.code ?? `HTTP_${response.status}`;
    const message = scrub(
      [body?.error?.message, detail?.message].filter(Boolean).join(": ") ||
        `ZeptoMail returned ${response.status}`,
      token,
    );
    const status = response.status;
    const retryAfter = Number(response.headers.get("retry-after"));
    const retryAfterSeconds =
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;

    if (status === 429 || status >= 500) {
      return new ProviderError("transient", code, message, { status, retryAfterSeconds });
    }
    if (status === 401 || status === 403) {
      return new ProviderError("auth", code, message, { status });
    }
    // Only a problem with the "to" address means the recipient is bad (never the sender's address).
    const invalidRecipient =
      detail?.target === "to" ||
      /invalid (recipient|to address)|recipient.*(invalid|does not exist)/i.test(message);
    return new ProviderError("permanent", code, message, { status, invalidRecipient });
  }

  /**
   * ZeptoMail has no "who am I" call for a Send Mail token. An email request with NO content is
   * checked for the token and then refused for its missing fields, so nothing can ever be sent:
   * refused token (401/403) = not connected; refused content (400) = the token works.
   */
  async verifyConnection(): Promise<CheckResult> {
    let response: Response;
    try {
      response = await this.post({});
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (response.ok) return { ok: true };
    const err = await ZeptoMailProvider.errorFromResponse(response, this.creds.token);
    const tokenProblem = /token|authori[sz]|credential/i.test(err.message);
    if (err.kind === "auth" || tokenProblem) {
      return {
        ok: false,
        error: `ZeptoMail refused the token (${err.message}). Paste the Send Mail token of your Mail Agent and check the region (${this.host}).`,
      };
    }
    if (err.status === 400 || err.status === 422) return { ok: true };
    return { ok: false, error: err.message };
  }

  /** ZeptoMail cannot look up mailboxes: the sender's domain only has to be verified in ZeptoMail. */
  async verifyMailbox(): Promise<CheckResult> {
    return {
      ok: true,
      error:
        "Not checked: ZeptoMail cannot look up mailboxes (the domain must be verified in ZeptoMail).",
    };
  }

  async listMailboxes(): Promise<MailboxInfo[]> {
    throw new ProviderError(
      "permanent",
      "NOT_SUPPORTED",
      "ZeptoMail cannot list mailboxes. Use “Add manually instead” and choose the ZeptoMail connection under “Send through”.",
    );
  }

  /** ZeptoMail only sends; it cannot read an inbox, so no bounces or replies are found here. */
  async listReceivedEmails(): Promise<ReceivedEmail[]> {
    return [];
  }

  /**
   * One email: our own text + HTML (made from the text when there is none). Replies go to the sending
   * address. ZeptoMail's own open/click tracking is off: the engine has its own tracking links, and
   * a tracking pixel makes cold email look like marketing. ZeptoMail makes the Message-ID itself.
   */
  async send(input: SendInput): Promise<SendResult> {
    const sender = { address: input.from, ...(input.fromName ? { name: input.fromName } : {}) };
    const response = await this.post({
      from: sender,
      to: [{ email_address: { address: input.to } }],
      reply_to: [sender],
      subject: input.subject,
      textbody: input.text,
      htmlbody: input.html ?? textToHtml(input.text),
      track_clicks: false,
      track_opens: false,
    });
    if (!response.ok) throw await ZeptoMailProvider.errorFromResponse(response, this.creds.token);
    const body = (await response.json().catch(() => null)) as { request_id?: string } | null;
    return { providerMessageId: body?.request_id, format: "mime" };
  }
}
