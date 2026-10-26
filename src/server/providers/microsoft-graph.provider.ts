import { ConfidentialClientApplication } from "@azure/msal-node";
import { mimeForSend } from "@/server/lib/mime";
import { outlookReplyBody, outlookSendMailBody } from "@/server/lib/outlook-message";
import {
  ProviderError,
  type CheckResult,
  type EmailProvider,
  type MailboxInfo,
  type ReceivedEmail,
  type SendFormat,
  type SendInput,
  type SendResult,
  type SentEmail,
} from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const REQUEST_TIMEOUT_MS = 30_000;
/** Get a new token when the cached one has less than this left. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type MicrosoftCredentials = { tenantId: string; clientId: string; clientSecret: string };

// One MSAL app per credential set, and our own in-memory token cache per connection.
const msalApps = new Map<string, ConfidentialClientApplication>();
const tokens = new Map<string, { accessToken: string; expiresAt: number }>();

function msalApp(creds: MicrosoftCredentials, cacheKey: string) {
  let app = msalApps.get(cacheKey);
  if (!app) {
    app = new ConfidentialClientApplication({
      auth: {
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        authority: `https://login.microsoftonline.com/${encodeURIComponent(creds.tenantId)}`,
      },
    });
    msalApps.set(cacheKey, app);
  }
  return app;
}

/** Forget cached tokens for a connection (call after its credentials change or it is deleted). */
export function clearMicrosoftTokenCache(connectionId: string) {
  for (const map of [msalApps, tokens]) {
    for (const key of map.keys()) {
      if (key.startsWith(`${connectionId}:`)) map.delete(key);
    }
  }
}

/** Removes anything that looks like the secret from a message before it is stored or logged. */
function scrub(message: string, secret: string) {
  return secret ? message.split(secret).join("[secret]") : message;
}

/**
 * The application permissions inside an app-only access token (its `roles` claim), e.g.
 * ["Mail.Send", "Mail.Read"]. The token is only read here, not checked — Microsoft checks it.
 * null = not a readable token.
 */
export function permissionsFromToken(token: string): string[] | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      roles?: unknown;
    };
    return Array.isArray(claims.roles)
      ? claims.roles.filter((r): r is string => typeof r === "string")
      : [];
  } catch {
    return null;
  }
}

const MISSING_MAIL_READ =
  "The app cannot read this mailbox (bounces and replies are not detected). In Azure: App registrations → API permissions → add Microsoft Graph → Application permissions → Mail.Read, then click Grant admin consent.";

/**
 * Sends through Microsoft Graph with an app-only token (OAuth 2.0 client credentials).
 * Needs the Application permission Mail.Send (+ admin consent); User.Read.All is optional (mailbox check);
 * Mail.Read is optional (bounce and reply detection, the Message-ID of Outlook-format emails, and
 * finding the first email of a follow-up when its id is not known).
 */
export class MicrosoftGraphProvider implements EmailProvider {
  private readonly cacheKey: string;
  private readonly sendFormat: SendFormat;

  constructor(
    private readonly creds: MicrosoftCredentials,
    /** Used to cache the token per connection; include updatedAt so new credentials get a new app. */
    cacheKey: string,
    /**
     * outlook = JSON (Microsoft builds the email), mime = raw email built by the engine.
     * getProvider() passes the connection's setting (default "outlook"); without it this class keeps
     * its original behaviour, "mime".
     */
    options: { sendFormat?: SendFormat } = {},
  ) {
    this.cacheKey = cacheKey;
    this.sendFormat = options.sendFormat ?? "mime";
  }

  /** Returns a cached token while it has more than 5 minutes left, otherwise asks Microsoft for a new one. */
  private async token(): Promise<string> {
    const cached = tokens.get(this.cacheKey);
    if (cached && cached.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS)
      return cached.accessToken;

    try {
      const result = await msalApp(this.creds, this.cacheKey).acquireTokenByClientCredential({
        scopes: [GRAPH_SCOPE],
        // MSAL has its own cache; skip it so our 5-minute margin decides when to refresh.
        skipCache: true,
      });
      if (!result?.accessToken) {
        throw new ProviderError("auth", "NO_TOKEN", "Microsoft did not return an access token");
      }
      const expiresAt = result.expiresOn?.getTime() ?? Date.now() + 60 * 60 * 1000;
      tokens.set(this.cacheKey, { accessToken: result.accessToken, expiresAt });
      return result.accessToken;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw this.tokenError(err);
    }
  }

  /** MSAL errors → readable messages. AADSTS codes come from Microsoft Entra ID. */
  private tokenError(err: unknown): ProviderError {
    const raw = err instanceof Error ? err.message : String(err);
    const message = scrub(raw, this.creds.clientSecret);
    const known: [RegExp, string][] = [
      [/AADSTS7000215|AADSTS7000222/, "The client secret is wrong or has expired."],
      [/AADSTS700016/, "The Client ID (application) was not found in this tenant."],
      [/AADSTS90002|AADSTS900023/, "The Tenant ID was not found."],
      [/AADSTS50034/, "The tenant or application does not exist."],
    ];
    const hit = known.find(([pattern]) => pattern.test(message));
    if (hit) return new ProviderError("auth", "INVALID_CREDENTIALS", hit[1]);
    if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|network/i.test(message)) {
      return new ProviderError("transient", "NETWORK", "Could not reach Microsoft. Try again.");
    }
    return new ProviderError("auth", "TOKEN_FAILED", `Could not get a token: ${message}`);
  }

  private async graph(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.token();
    try {
      return await fetch(`${GRAPH}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ProviderError(
        "transient",
        "NETWORK",
        "Could not reach Microsoft Graph (timeout or network error)",
      );
    }
  }

  /** Graph error response → transient / permanent / auth (BUILD_PLAN section 6). */
  static async errorFromResponse(response: Response): Promise<ProviderError> {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    const code = body?.error?.code ?? `HTTP_${response.status}`;
    const message = body?.error?.message ?? `Microsoft Graph returned ${response.status}`;
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
    const invalidRecipient = /InvalidRecipients|ErrorInvalidRecipients|RecipientNotFound/i.test(
      `${code} ${message}`,
    );
    return new ProviderError("permanent", code, message, { status, invalidRecipient });
  }

  async verifyConnection(): Promise<CheckResult> {
    try {
      await this.token();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Which application permissions admin consent was given for (read from the access token). */
  async grantedPermissions(): Promise<string[] | null> {
    return permissionsFromToken(await this.token());
  }

  /** Checks the mailbox exists. Needs User.Read.All; without it we can't tell and say so clearly. */
  async verifyMailbox(email: string): Promise<CheckResult> {
    try {
      const response = await this.graph(`/users/${encodeURIComponent(email)}?$select=id`);
      if (response.ok) return { ok: true };
      if (response.status === 404) {
        return { ok: false, error: `The mailbox ${email} does not exist in Microsoft 365` };
      }
      if (response.status === 403) {
        return {
          ok: true,
          error:
            "Mailbox not checked: the app does not have the optional User.Read.All permission. Sending still works with Mail.Send.",
        };
      }
      const err = await MicrosoftGraphProvider.errorFromResponse(response);
      return { ok: false, error: err.message };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Lists the users whose address ends with @domain (follows Graph's paging links).
   * Needs the Application permission User.Read.All (+ admin consent).
   */
  async listMailboxes(domain: string): Promise<MailboxInfo[]> {
    const suffix = `@${domain.toLowerCase()}`;
    const found = new Map<string, MailboxInfo>();
    const filter = encodeURIComponent(
      `endswith(userPrincipalName,'${suffix.replace(/'/g, "''")}') or endswith(mail,'${suffix.replace(/'/g, "''")}')`,
    );
    let path: string | null =
      `/users?$filter=${filter}&$select=displayName,mail,userPrincipalName,accountEnabled&$top=100&$count=true`;

    for (let pages = 0; path && pages < 50; pages++) {
      const response: Response = await this.graph(path, {
        headers: { ConsistencyLevel: "eventual" }, // required for endswith() on mail
      });
      if (response.status === 403) {
        throw new ProviderError(
          "auth",
          "MISSING_PERMISSION",
          "The app is missing the User.Read.All permission. In Azure: App registrations → API permissions → add Microsoft Graph → Application permissions → User.Read.All, then click Grant admin consent.",
          { status: 403 },
        );
      }
      if (!response.ok) throw await MicrosoftGraphProvider.errorFromResponse(response);

      const body = (await response.json()) as {
        value: {
          displayName?: string | null;
          mail?: string | null;
          userPrincipalName?: string | null;
          accountEnabled?: boolean | null;
        }[];
        "@odata.nextLink"?: string;
      };
      for (const user of body.value) {
        // `mail` can be empty on some accounts; the sign-in name is usually the address.
        const email = (user.mail || user.userPrincipalName || "").toLowerCase();
        if (!email.endsWith(suffix) || email.includes("#EXT#".toLowerCase())) continue;
        found.set(email, {
          email,
          displayName: user.displayName ?? "",
          enabled: user.accountEnabled !== false,
        });
      }
      const next = body["@odata.nextLink"];
      path = next ? next.replace(GRAPH, "") : null;
    }
    return [...found.values()].sort((a, b) => a.email.localeCompare(b.email));
  }

  /**
   * Lists emails in the mailbox's Inbox folder received since `since` (follows paging, max 500).
   * Needs the Application permission Mail.Read (+ admin consent). Read-only.
   */
  async listReceivedEmails(mailbox: string, since: Date): Promise<ReceivedEmail[]> {
    const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
    let path: string | null =
      `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages?$filter=${filter}` +
      `&$orderby=receivedDateTime desc&$top=50&$select=id,receivedDateTime,from,subject,body,uniqueBody`;
    const emails: ReceivedEmail[] = [];

    for (let pages = 0; path && pages < 10; pages++) {
      const response: Response = await this.graph(path, {
        headers: { Prefer: 'outlook.body-content-type="text"' }, // bodies as plain text
      });
      if (response.status === 403) {
        throw new ProviderError("auth", "MISSING_PERMISSION", MISSING_MAIL_READ, { status: 403 });
      }
      if (!response.ok) throw await MicrosoftGraphProvider.errorFromResponse(response);

      const page = (await response.json()) as {
        value: {
          id: string;
          receivedDateTime: string;
          subject?: string | null;
          from?: { emailAddress?: { address?: string | null; name?: string | null } } | null;
          body?: { content?: string | null } | null;
          uniqueBody?: { content?: string | null } | null;
        }[];
        "@odata.nextLink"?: string;
      };
      for (const m of page.value) {
        emails.push({
          id: m.id,
          receivedAt: new Date(m.receivedDateTime),
          fromEmail: (m.from?.emailAddress?.address ?? "").toLowerCase(),
          fromName: m.from?.emailAddress?.name ?? "",
          subject: m.subject ?? "",
          body: m.body?.content ?? "",
          uniqueBody: m.uniqueBody?.content ?? m.body?.content ?? "",
        });
      }
      const next = page["@odata.nextLink"];
      path = next ? next.replace(GRAPH, "") : null;
    }
    return emails;
  }

  /**
   * Emails in the mailbox's Sent Items folder sent since `since` (follows paging, max 500).
   * Used to learn the Message-ID Microsoft gave an Outlook-format email. Needs Mail.Read. Read-only.
   */
  async listSentEmails(mailbox: string, since: Date): Promise<SentEmail[]> {
    // $orderby must use the same property as $filter, in the same order (Graph rule).
    const filter = encodeURIComponent(`sentDateTime ge ${since.toISOString()}`);
    let path: string | null =
      `/users/${encodeURIComponent(mailbox)}/mailFolders/sentitems/messages?$filter=${filter}` +
      `&$orderby=sentDateTime desc&$top=50&$select=id,internetMessageId,subject,toRecipients,sentDateTime`;
    const emails: SentEmail[] = [];

    for (let pages = 0; path && pages < 10; pages++) {
      const response: Response = await this.graph(path);
      if (response.status === 403) {
        throw new ProviderError("auth", "MISSING_PERMISSION", MISSING_MAIL_READ, { status: 403 });
      }
      if (!response.ok) throw await MicrosoftGraphProvider.errorFromResponse(response);

      const page = (await response.json()) as {
        value: {
          id: string;
          internetMessageId?: string | null;
          subject?: string | null;
          sentDateTime?: string | null;
          toRecipients?: { emailAddress?: { address?: string | null } | null }[] | null;
        }[];
        "@odata.nextLink"?: string;
      };
      for (const m of page.value) {
        if (!m.internetMessageId || !m.sentDateTime) continue;
        emails.push({
          id: m.id,
          internetMessageId: m.internetMessageId,
          subject: m.subject ?? "",
          to: (m.toRecipients ?? [])
            .map((r) => (r.emailAddress?.address ?? "").toLowerCase())
            .filter(Boolean),
          sentAt: new Date(m.sentDateTime),
        });
      }
      const next = page["@odata.nextLink"];
      path = next ? next.replace(GRAPH, "") : null;
    }
    return emails;
  }

  /**
   * The Graph id of the email in this mailbox with that Message-ID, or null when it is not there or the
   * app may not read the mailbox (no Mail.Read). Looks in every folder, in case it was moved.
   */
  private async findByInternetMessageId(mailbox: string, internetMessageId: string) {
    const filter = encodeURIComponent(
      `internetMessageId eq '${internetMessageId.replace(/'/g, "''")}'`,
    );
    const response = await this.graph(
      `/users/${encodeURIComponent(mailbox)}/messages?$filter=${filter}&$select=id&$top=1`,
    );
    if (response.status === 403 || response.status === 404) return null;
    if (!response.ok) throw await MicrosoftGraphProvider.errorFromResponse(response);
    const body = (await response.json()) as { value?: { id: string }[] };
    return body.value?.[0]?.id ?? null;
  }

  /**
   * Follow-up the Outlook way: Graph's `reply` action on the first email, so Exchange threads it
   * (In-Reply-To, References, subject "RE: …") and quotes the first email below. Needs only Mail.Send
   * when the first email's Graph id is known; finding it by Message-ID needs Mail.Read.
   * Returns false when the first email cannot be found (nothing was sent).
   */
  private async reply(input: SendInput): Promise<boolean> {
    const known = input.parentProviderMessageId;
    if (known && (await this.replyTo(known, input))) return true;
    // Unknown id, or that email was moved (its id changed): look it up by its Message-ID.
    if (!input.inReplyTo) return false;
    const found = await this.findByInternetMessageId(input.from, input.inReplyTo);
    return !!found && found !== known && this.replyTo(found, input);
  }

  /** true = sent; false = that email does not exist (404), nothing was sent. */
  private async replyTo(id: string, input: SendInput): Promise<boolean> {
    const response = await this.graph(
      `/users/${encodeURIComponent(input.from)}/messages/${encodeURIComponent(id)}/reply`,
      { method: "POST", body: JSON.stringify(outlookReplyBody(input)) },
    );
    if (response.status === 202 || response.ok) return true;
    if (response.status === 404) return false;
    throw await MicrosoftGraphProvider.errorFromResponse(response);
  }

  /**
   * Sends the email in the connection's format.
   * - outlook: JSON to /sendMail (or /reply for a follow-up). Microsoft builds the email like Outlook
   *   does; Graph answers 202 with no body, so the Message-ID is learned later from Sent Items.
   * - mime: raw MIME (multipart/alternative: text + HTML, our own headers), base64 with
   *   Content-Type text/plain.
   * Both are saved to Sent Items.
   */
  async send(input: SendInput): Promise<SendResult> {
    if (this.sendFormat === "outlook") return this.sendOutlook(input);

    const { mime, messageId: internetMessageId } = mimeForSend(input);
    const response = await this.graph(`/users/${encodeURIComponent(input.from)}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: Buffer.from(mime, "utf8").toString("base64"),
    });
    // Graph returns 202 with no body / id
    if (response.status === 202 || response.ok) return { internetMessageId, format: "mime" };
    throw await MicrosoftGraphProvider.errorFromResponse(response);
  }

  private async sendOutlook(input: SendInput): Promise<SendResult> {
    if (input.inReplyTo || input.parentProviderMessageId) {
      if (await this.reply(input)) return { format: "outlook", threaded: true };
      // The first email is gone (or cannot be read): it goes out as a new email with its own subject.
    }
    const response = await this.graph(`/users/${encodeURIComponent(input.from)}/sendMail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(outlookSendMailBody(input)),
    });
    if (response.status === 202 || response.ok) return { format: "outlook", threaded: false };
    throw await MicrosoftGraphProvider.errorFromResponse(response);
  }
}
