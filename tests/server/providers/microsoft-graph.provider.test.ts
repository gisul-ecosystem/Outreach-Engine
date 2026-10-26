import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake MSAL: no real calls to Microsoft in tests.
const acquireToken = vi.fn();
vi.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: class {
    acquireTokenByClientCredential = acquireToken;
  },
}));

const { MicrosoftGraphProvider, clearMicrosoftTokenCache } =
  await import("@/server/providers/microsoft-graph.provider");

const SECRET = "super-secret-value-123";
const creds = { tenantId: "contoso.onmicrosoft.com", clientId: "id", clientSecret: SECRET };
let counter = 0;
const newProvider = () => new MicrosoftGraphProvider(creds, `test:${counter++}`);

const fetchMock = vi.fn();
beforeEach(() => {
  acquireToken.mockReset().mockResolvedValue({ accessToken: "token-abc" });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const graphError = (status: number, code: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { code, message: `${code} happened` } }), {
    status,
    headers,
  });

/** The raw email Graph received (MIME mode: base64 body, Content-Type text/plain). */
const sentMime = (call = 0) =>
  Buffer.from(fetchMock.mock.calls[call][1].body, "base64").toString("utf8");

describe("MicrosoftGraphProvider.send", () => {
  it("POSTs the raw MIME email to /users/{from}/sendMail with the bearer token", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const result = await newProvider().send({
      from: "sales@tryracko.in",
      fromName: "Sales Team",
      to: "lead@x.com",
      subject: "Hello",
      text: "Plain body",
      messageId: "<abc@tryracko.in>",
      listUnsubscribe: "<mailto:sales@tryracko.in?subject=unsubscribe>",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/users/sales%40tryracko.in/sendMail");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(init.headers["Content-Type"]).toBe("text/plain");
    const mime = sentMime();
    expect(mime).toContain('From: "Sales Team" <sales@tryracko.in>');
    expect(mime).toContain("To: <lead@x.com>");
    expect(mime).toContain("Subject: Hello");
    expect(mime).toContain("Message-ID: <abc@tryracko.in>");
    expect(mime).toContain('Reply-To: "Sales Team" <sales@tryracko.in>');
    expect(mime).toContain("List-Unsubscribe: <mailto:sales@tryracko.in?subject=unsubscribe>");
    expect(mime).toContain("MIME-Version: 1.0");
    expect(mime).toContain("Content-Type: multipart/alternative;");
    expect(mime).toContain("Content-Type: text/plain; charset=UTF-8");
    expect(mime).toContain("Content-Type: text/html; charset=UTF-8");
    expect(result.internetMessageId).toBe("<abc@tryracko.in>");
  });

  it("uses the given HTML part, and makes one from the text when there is none", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await newProvider().send({
      from: "a@b.co",
      to: "c@d.co",
      subject: "s",
      text: "t",
      html: "<p>mine</p>",
    });
    await newProvider().send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "only text" });
    expect(sentMime(0)).toContain("<p>mine</p>");
    expect(sentMime(1)).toContain("<p>only text</p>");
  });

  it.each([
    [429, "TooManyRequests", "transient"],
    [503, "ServiceUnavailable", "transient"],
    [401, "InvalidAuthenticationToken", "auth"],
    [403, "ErrorAccessDenied", "auth"],
    [400, "ErrorInvalidRecipients", "permanent"],
    [404, "ErrorInvalidUser", "permanent"],
  ])("HTTP %i %s → %s", async (status, code, kind) => {
    fetchMock.mockResolvedValue(graphError(status, code));
    await expect(
      newProvider().send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ name: "ProviderError", kind, code });
  });

  it("reads Retry-After on 429", async () => {
    fetchMock.mockResolvedValue(graphError(429, "TooManyRequests", { "retry-after": "120" }));
    await expect(
      newProvider().send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ kind: "transient", status: 429, retryAfterSeconds: 120 });
  });

  it("flags invalid recipients (so Phase 6 can suppress them)", async () => {
    fetchMock.mockResolvedValue(graphError(400, "ErrorInvalidRecipients"));
    await expect(
      newProvider().send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ kind: "permanent", status: 400, invalidRecipient: true });
  });

  it("network failure → transient", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      newProvider().send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ kind: "transient", code: "NETWORK" });
  });
});

describe("token cache (until 5 minutes before expiry)", () => {
  const send = (provider: InstanceType<typeof MicrosoftGraphProvider>) =>
    provider.send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" });
  const expiresIn = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  beforeEach(() => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 202 }));
  });

  it("reuses the token for later sends", async () => {
    acquireToken.mockResolvedValue({ accessToken: "t1", expiresOn: expiresIn(60) });
    const provider = newProvider();
    await send(provider);
    await send(provider);
    await send(provider);
    expect(acquireToken).toHaveBeenCalledTimes(1);
  });

  it("shares the cache between provider objects for the same connection", async () => {
    acquireToken.mockResolvedValue({ accessToken: "t1", expiresOn: expiresIn(60) });
    await send(new MicrosoftGraphProvider(creds, "conn-shared:1"));
    await send(new MicrosoftGraphProvider(creds, "conn-shared:1"));
    expect(acquireToken).toHaveBeenCalledTimes(1);
  });

  it("gets a new token once less than 5 minutes are left", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    acquireToken
      .mockResolvedValueOnce({ accessToken: "t1", expiresOn: expiresIn(60) })
      .mockResolvedValueOnce({ accessToken: "t2", expiresOn: expiresIn(120) });
    const provider = newProvider();
    await send(provider);

    vi.setSystemTime(Date.now() + 54 * 60_000); // 6 minutes left → still cached
    await send(provider);
    expect(acquireToken).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 2 * 60_000); // 4 minutes left → refresh
    await send(provider);
    expect(acquireToken).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.at(-1)?.[1].headers.Authorization).toBe("Bearer t2");
  });

  it("asks MSAL to skip its own cache so our margin decides", async () => {
    acquireToken.mockResolvedValue({ accessToken: "t1", expiresOn: expiresIn(60) });
    await send(newProvider());
    expect(acquireToken.mock.calls[0][0]).toMatchObject({
      scopes: ["https://graph.microsoft.com/.default"],
      skipCache: true,
    });
  });

  it("clearMicrosoftTokenCache forgets the token (e.g. after the secret changes)", async () => {
    acquireToken.mockResolvedValue({ accessToken: "t1", expiresOn: expiresIn(60) });
    const provider = new MicrosoftGraphProvider(creds, "conn-clear:1");
    await send(provider);
    clearMicrosoftTokenCache("conn-clear");
    await send(provider);
    expect(acquireToken).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    acquireToken
      .mockRejectedValueOnce(new Error("AADSTS7000215: Invalid client secret provided"))
      .mockResolvedValueOnce({ accessToken: "t1", expiresOn: expiresIn(60) });
    const provider = newProvider();
    await expect(send(provider)).rejects.toMatchObject({ kind: "auth" });
    await expect(send(provider)).resolves.toMatchObject({ internetMessageId: expect.any(String) });
  });
});

describe("MicrosoftGraphProvider.verifyMailbox", () => {
  it("explains clearly when User.Read.All is missing (instead of failing)", async () => {
    fetchMock.mockResolvedValue(graphError(403, "Authorization_RequestDenied"));
    const result = await newProvider().verifyMailbox("sales@tryracko.in");
    expect(result.ok).toBe(true);
    expect(result.error).toMatch(/User\.Read\.All/);
  });

  it("reports a mailbox that does not exist", async () => {
    fetchMock.mockResolvedValue(graphError(404, "Request_ResourceNotFound"));
    expect(await newProvider().verifyMailbox("nobody@tryracko.in")).toMatchObject({ ok: false });
  });
});

describe("MicrosoftGraphProvider.verifyConnection", () => {
  it("is ok when Microsoft returns a token", async () => {
    expect(await newProvider().verifyConnection()).toEqual({ ok: true });
  });

  it("explains a wrong secret without ever including it", async () => {
    acquireToken.mockRejectedValue(
      new Error(`AADSTS7000215: Invalid client secret provided. Secret: ${SECRET}`),
    );
    const result = await newProvider().verifyConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("The client secret is wrong or has expired.");
    expect(result.error).not.toContain(SECRET);
  });

  it("removes the secret from unknown error messages too", async () => {
    acquireToken.mockRejectedValue(new Error(`weird failure ${SECRET}`));
    const result = await newProvider().verifyConnection();
    expect(result.error).not.toContain(SECRET);
    expect(result.error).toContain("[secret]");
  });
});

describe("MicrosoftGraphProvider.listMailboxes", () => {
  const page = (value: unknown[], nextLink?: string) =>
    new Response(JSON.stringify({ value, "@odata.nextLink": nextLink }), { status: 200 });

  it("filters by domain, follows paging, falls back to the sign-in name and skips guests", async () => {
    fetchMock
      .mockResolvedValueOnce(
        page(
          [
            { displayName: "Sales", mail: "Sales@tryracko.in", accountEnabled: true },
            { displayName: "Guest", mail: "guest_x.com#EXT#@tryracko.in" },
            { displayName: "Other", mail: "bob@other.com" },
          ],
          "https://graph.microsoft.com/v1.0/users?$skiptoken=abc",
        ),
      )
      .mockResolvedValueOnce(
        page([
          {
            displayName: "Hello",
            mail: null,
            userPrincipalName: "hello@tryracko.in",
            accountEnabled: false,
          },
        ]),
      );

    const result = await newProvider().listMailboxes("tryracko.in");

    expect(result).toEqual([
      { email: "hello@tryracko.in", displayName: "Hello", enabled: false },
      { email: "sales@tryracko.in", displayName: "Sales", enabled: true },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.ConsistencyLevel).toBe("eventual");
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://graph.microsoft.com/v1.0/users?$skiptoken=abc",
    );
  });

  it("explains the missing User.Read.All permission on 403", async () => {
    fetchMock.mockResolvedValue(graphError(403, "Authorization_RequestDenied"));
    await expect(newProvider().listMailboxes("tryracko.in")).rejects.toMatchObject({
      kind: "auth",
      code: "MISSING_PERMISSION",
      message: expect.stringContaining("User.Read.All"),
    });
  });
});
