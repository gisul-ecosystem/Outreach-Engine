import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fake MSAL: no real calls to Microsoft in tests.
const acquireToken = vi.fn();
vi.mock("@azure/msal-node", () => ({
  ConfidentialClientApplication: class {
    acquireTokenByClientCredential = acquireToken;
  },
}));

const { MicrosoftGraphProvider, permissionsFromToken } =
  await import("@/server/providers/microsoft-graph.provider");
const { FakeProvider } = await import("@/server/providers/fake.provider");

const creds = {
  tenantId: "contoso.onmicrosoft.com",
  clientId: "id",
  clientSecret: "secret-123456",
};
let counter = 0;
const outlook = () =>
  new MicrosoftGraphProvider(creds, `outlook:${counter++}`, { sendFormat: "outlook" });

const fetchMock = vi.fn();
beforeEach(() => {
  acquireToken.mockReset().mockResolvedValue({ accessToken: "token-abc" });
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const accepted = () => new Response(null, { status: 202 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const graphError = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: `${code} happened` } }), { status });
const call = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i];
  const isJson = init.headers["Content-Type"] === "application/json" && init.body;
  return { url: url as string, init, body: isJson ? JSON.parse(init.body) : null };
};

const email = {
  from: "sales@tryracko.in",
  fromName: "Sales Team",
  to: "lead@x.com",
  subject: "Quick question",
  text: "Hi Ann,\n\nShort note.\nSecond line.\n\nNot relevant? Just reply 'no' and I won't email again.",
  messageId: "<abc@tryracko.in>",
  listUnsubscribe: "<mailto:sales@tryracko.in?subject=unsubscribe>",
};

describe("Outlook format: sendMail with JSON", () => {
  it("POSTs JSON to /users/{from}/sendMail: HTML body, recipient, saveToSentItems — nothing else", async () => {
    fetchMock.mockResolvedValue(accepted());
    const result = await outlook().send(email);

    const { url, init, body } = call();
    expect(url).toBe("https://graph.microsoft.com/v1.0/users/sales%40tryracko.in/sendMail");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers.Authorization).toBe("Bearer token-abc");
    expect(Object.keys(body).sort()).toEqual(["message", "saveToSentItems"]);
    expect(body.saveToSentItems).toBe(true);
    expect(Object.keys(body.message).sort()).toEqual(["body", "subject", "toRecipients"]);
    expect(body.message.subject).toBe("Quick question");
    expect(body.message.body.contentType).toBe("HTML");
    expect(body.message.toRecipients).toEqual([{ emailAddress: { address: "lead@x.com" } }]);
    expect(result).toEqual({ format: "outlook", threaded: false });
  });

  it("sets no Message-ID, Date, MIME-Version, Reply-To or List-Unsubscribe of its own", async () => {
    fetchMock.mockResolvedValue(accepted());
    await outlook().send(email);
    const raw = call().init.body as string;
    for (const header of ["Message-ID", "List-Unsubscribe", "Reply-To", "MIME-Version", "Date:"]) {
      expect(raw).not.toContain(header);
    }
    expect(raw).not.toContain("<abc@tryracko.in>");
    expect(call().body.message).not.toHaveProperty("internetMessageHeaders");
    expect(call().body.message).not.toHaveProperty("replyTo");
    expect(call().body.message).not.toHaveProperty("from");
  });

  it("lays text out like Outlook (Aptos/Calibri, <p> paragraphs, no <html> wrapper); keeps the opt-out in the body", async () => {
    fetchMock.mockResolvedValue(accepted());
    await outlook().send(email);
    const html = call().body.message.body.content as string;
    expect(html).toMatch(/^<div style="font-family: Aptos, Calibri/);
    expect(html).toContain("<p style=");
    expect(html).toContain("Short note.<br>Second line.");
    expect(html).toContain("Just reply &#39;no&#39; and I won&#39;t email again.");
    expect(html).not.toMatch(/<html|<body|color: #888/);
  });

  it("uses the campaign's own HTML version as it is", async () => {
    fetchMock.mockResolvedValue(accepted());
    await outlook().send({ ...email, html: "<p>mine</p>" });
    expect(call().body.message.body.content).toBe("<p>mine</p>");
  });

  it.each([
    [429, "TooManyRequests", "transient"],
    [503, "ServiceUnavailable", "transient"],
    [401, "InvalidAuthenticationToken", "auth"],
    [403, "ErrorSendAsDenied", "auth"],
    [400, "ErrorInvalidRecipients", "permanent"],
    [413, "ErrorMessageSizeExceeded", "permanent"],
    [404, "ErrorInvalidUser", "permanent"],
  ])("HTTP %i %s → %s (same kinds as MIME)", async (status, code, kind) => {
    fetchMock.mockResolvedValue(graphError(status, code));
    await expect(outlook().send(email)).rejects.toMatchObject({
      name: "ProviderError",
      kind,
      code,
    });
  });

  it("network failure → transient", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(outlook().send(email)).rejects.toMatchObject({
      kind: "transient",
      code: "NETWORK",
    });
  });
});

describe("Outlook format: follow-ups are replies in the same thread", () => {
  const followUp = { ...email, subject: "Re: Quick question", inReplyTo: "<first@tryracko.in>" };

  it("replies to the first email by its Graph id: recipient set, no subject (Exchange makes it RE: …)", async () => {
    fetchMock.mockResolvedValue(accepted());
    const result = await outlook().send({ ...followUp, parentProviderMessageId: "AAMk=1" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, body } = call();
    expect(url).toBe(
      "https://graph.microsoft.com/v1.0/users/sales%40tryracko.in/messages/AAMk%3D1/reply",
    );
    expect(body.message).toEqual({ toRecipients: [{ emailAddress: { address: "lead@x.com" } }] });
    expect(body.comment).toContain("Short note.");
    expect(body.message).not.toHaveProperty("body"); // Graph refuses comment AND body together
    expect(result).toEqual({ format: "outlook", threaded: true });
  });

  it("finds the first email by its Message-ID when the id is unknown", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ value: [{ id: "found-1" }] }))
      .mockResolvedValueOnce(accepted());
    const result = await outlook().send(followUp);

    expect(decodeURIComponent(call(0).url)).toContain(
      "/users/sales@tryracko.in/messages?$filter=internetMessageId eq '<first@tryracko.in>'",
    );
    expect(call(1).url).toContain("/messages/found-1/reply");
    expect(result.threaded).toBe(true);
  });

  it("the saved id is gone (404): looks it up by Message-ID and replies to that", async () => {
    fetchMock
      .mockResolvedValueOnce(graphError(404, "ErrorItemNotFound"))
      .mockResolvedValueOnce(json({ value: [{ id: "moved-1" }] }))
      .mockResolvedValueOnce(accepted());
    const result = await outlook().send({ ...followUp, parentProviderMessageId: "old-id" });
    expect(call(2).url).toContain("/messages/moved-1/reply");
    expect(result.threaded).toBe(true);
  });

  it("cannot find the first email (no Mail.Read): sends it as a new email with its own subject", async () => {
    fetchMock
      .mockResolvedValueOnce(graphError(403, "ErrorAccessDenied"))
      .mockResolvedValueOnce(accepted());
    const result = await outlook().send(followUp);
    expect(call(1).url).toMatch(/\/sendMail$/);
    expect(call(1).body.message.subject).toBe("Re: Quick question");
    expect(result).toEqual({ format: "outlook", threaded: false });
  });

  it("a real error on reply is reported like any send error (nothing is sent twice)", async () => {
    fetchMock.mockResolvedValue(graphError(429, "TooManyRequests"));
    await expect(
      outlook().send({ ...followUp, parentProviderMessageId: "x" }),
    ).rejects.toMatchObject({
      kind: "transient",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("MIME format is unchanged", () => {
  it("still posts base64 MIME with our headers when sendFormat is mime", async () => {
    fetchMock.mockResolvedValue(accepted());
    const provider = new MicrosoftGraphProvider(creds, `mime:${counter++}`, { sendFormat: "mime" });
    const result = await provider.send(email);
    expect(call().init.headers["Content-Type"]).toBe("text/plain");
    const mime = Buffer.from(call().init.body, "base64").toString("utf8");
    expect(mime).toContain("Message-ID: <abc@tryracko.in>");
    expect(mime).toContain("List-Unsubscribe:");
    expect(result).toEqual({ internetMessageId: "<abc@tryracko.in>", format: "mime" });
  });
});

describe("listSentEmails (Sent Items, for the Message-ID Microsoft made)", () => {
  it("reads Sent Items since a time, newest first, with the fields needed to match", async () => {
    fetchMock.mockResolvedValue(
      json({
        value: [
          {
            id: "g1",
            internetMessageId: "<ms1@x.prod.outlook.com>",
            subject: "Quick question",
            sentDateTime: "2026-10-22T05:00:00Z",
            toRecipients: [{ emailAddress: { address: "Lead@X.com" } }],
          },
          { id: "draft", internetMessageId: null, sentDateTime: null },
        ],
      }),
    );
    const since = new Date("2026-10-22T04:00:00Z");
    const sent = await outlook().listSentEmails("sales@tryracko.in", since);
    expect(decodeURIComponent(call().url)).toContain(
      "/users/sales@tryracko.in/mailFolders/sentitems/messages?$filter=sentDateTime ge 2026-10-22T04:00:00.000Z&$orderby=sentDateTime desc",
    );
    expect(sent).toEqual([
      {
        id: "g1",
        internetMessageId: "<ms1@x.prod.outlook.com>",
        subject: "Quick question",
        to: ["lead@x.com"],
        sentAt: new Date("2026-10-22T05:00:00Z"),
      },
    ]);
  });

  it("explains a missing Mail.Read permission", async () => {
    fetchMock.mockResolvedValue(graphError(403, "ErrorAccessDenied"));
    await expect(outlook().listSentEmails("a@b.co", new Date())).rejects.toMatchObject({
      code: "MISSING_PERMISSION",
      message: expect.stringContaining("Mail.Read"),
    });
  });
});

describe("listSentItems (Sent Items with every recipient, to track emails sent by hand)", () => {
  const item = (id: string, sentDateTime: string) => ({
    id,
    internetMessageId: `<${id}@x.prod.outlook.com>`,
    conversationId: `conv-${id}`,
    subject: "Hello",
    sentDateTime,
    toRecipients: [{ emailAddress: { address: "Ann@X.com" } }],
    ccRecipients: [{ emailAddress: { address: "bob@x.com" } }],
    bccRecipients: [],
    body: {
      contentType: "html",
      content: `<p>Hi Ann, <a href="https://go.racko.ai/r/${id}Token0001">take a look at Racko</a></p>`,
    },
  });

  it("reads a time range oldest first, with To/CC/BCC, following paging", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          value: [item("g1", "2026-10-22T05:00:00Z")],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/users/sales@tryracko.in/mailFolders/sentitems/messages?$skip=50",
        }),
      )
      .mockResolvedValueOnce(
        json({ value: [item("g2", "2026-10-22T06:00:00Z"), { id: "draft", sentDateTime: null }] }),
      );
    const page = await outlook().listSentItems(
      "sales@tryracko.in",
      new Date("2026-10-22T04:00:00Z"),
      new Date("2026-10-22T07:00:00Z"),
    );
    const url = decodeURIComponent(call().url);
    expect(url).toContain(
      "$filter=sentDateTime ge 2026-10-22T04:00:00.000Z and sentDateTime le 2026-10-22T07:00:00.000Z&$orderby=sentDateTime asc",
    );
    expect(url).toContain("ccRecipients,bccRecipients,sentDateTime,body");
    expect(decodeURIComponent(call(1).url)).toContain("$skip=50");
    expect(page.complete).toBe(true);
    // Only the tracking tokens are taken from the body; the body itself is not returned.
    expect(page.items).toEqual([
      {
        id: "g1",
        internetMessageId: "<g1@x.prod.outlook.com>",
        conversationId: "conv-g1",
        subject: "Hello",
        to: ["ann@x.com"],
        cc: ["bob@x.com"],
        bcc: [],
        sentAt: new Date("2026-10-22T05:00:00Z"),
        linkTokens: ["g1Token0001"],
      },
      expect.objectContaining({ id: "g2", linkTokens: ["g2Token0001"] }),
    ]);
    expect(JSON.stringify(page)).not.toContain("Hi Ann");
  });

  it("says when it stopped at the page cap (more emails remain)", async () => {
    fetchMock.mockImplementation(async () =>
      json({
        value: [item("g", "2026-10-22T05:00:00Z")],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/users/a@b.co/next",
      }),
    );
    const page = await outlook().listSentItems("a@b.co", new Date(0), new Date());
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(page.complete).toBe(false);
  });

  it("explains a missing Mail.Read permission", async () => {
    fetchMock.mockResolvedValue(graphError(403, "ErrorAccessDenied"));
    await expect(outlook().listSentItems("a@b.co", new Date(0), new Date())).rejects.toMatchObject({
      code: "MISSING_PERMISSION",
    });
  });
});

describe("granted permissions (read from the token's roles claim)", () => {
  const jwt = (claims: object) =>
    `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

  it("reads the roles", () => {
    expect(permissionsFromToken(jwt({ roles: ["Mail.Send", "Mail.Read"] }))).toEqual([
      "Mail.Send",
      "Mail.Read",
    ]);
    expect(permissionsFromToken(jwt({}))).toEqual([]);
    expect(permissionsFromToken("not-a-jwt")).toBeNull();
  });

  it("grantedPermissions() uses the provider's token", async () => {
    acquireToken.mockResolvedValue({ accessToken: jwt({ roles: ["Mail.Send"] }) });
    expect(await outlook().grantedPermissions()).toEqual(["Mail.Send"]);
  });
});

describe("FakeProvider (DRY_RUN) takes the same input in both formats", () => {
  const fake = (sendFormat: "outlook" | "mime") =>
    new FakeProvider({ failureRate: 0, minDelayMs: 0, maxDelayMs: 0, sendFormat });

  it("logs which format it would use and sends nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await fake("outlook").send({ ...email, inReplyTo: "<first@x>" });
    expect(log.mock.calls.flat().join(" ")).toContain(
      "Outlook format (JSON, reply in the first email's thread)",
    );
    expect(result).toMatchObject({ format: "outlook", threaded: true });
    expect(result.internetMessageId).not.toBe(email.messageId);
    expect(fetchMock).not.toHaveBeenCalled();

    const mime = await fake("mime").send(email);
    expect(log.mock.calls.flat().join(" ")).toContain("MIME format");
    expect(mime).toMatchObject({ format: "mime", internetMessageId: "<abc@tryracko.in>" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
