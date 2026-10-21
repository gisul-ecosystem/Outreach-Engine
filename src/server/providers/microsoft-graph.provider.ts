import { ConfidentialClientApplication } from "@azure/msal-node";
import {
  ProviderError,
  type CheckResult,
  type EmailProvider,
  type MailboxInfo,
  type SendInput,
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
 * Sends through Microsoft Graph with an app-only token (OAuth 2.0 client credentials).
 * Needs the Application permission Mail.Send (+ admin consent); User.Read.All is optional (mailbox check).
 */
export class MicrosoftGraphProvider implements EmailProvider {
  private readonly cacheKey: string;

  constructor(
    private readonly creds: MicrosoftCredentials,
    /** Used to cache the token per connection; include updatedAt so new credentials get a new app. */
    cacheKey: string,
  ) {
    this.cacheKey = cacheKey;
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

  async send(input: SendInput) {
    const response = await this.graph(`/users/${encodeURIComponent(input.from)}/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: input.html
            ? { contentType: "HTML", content: input.html }
            : { contentType: "Text", content: input.text },
          toRecipients: [{ emailAddress: { address: input.to } }],
          from: { emailAddress: { address: input.from, name: input.fromName } },
        },
        saveToSentItems: true, // so sent emails appear in the mailbox's Sent folder
      }),
    });
    if (response.status === 202 || response.ok) return {}; // Graph returns 202 with no body / id
    throw await MicrosoftGraphProvider.errorFromResponse(response);
  }
}
