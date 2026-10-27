import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderError } from "@/server/providers/types";
import { ZeptoMailProvider, zeptoApiUrl } from "@/server/providers/zeptomail.provider";

const TOKEN = "wSsVR60-very-secret-send-mail-token";
const newProvider = (region: "in" | "com" = "in") =>
  new ZeptoMailProvider({ token: TOKEN, region });

// No real calls to ZeptoMail in tests.
const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const zeptoError = (
  status: number,
  detail: { code: string; message: string; target?: string },
  headers: Record<string, string> = {},
) =>
  new Response(
    JSON.stringify({ error: { code: "TM_4001", message: "Error", details: [detail] } }),
    { status, headers },
  );
const accepted = () =>
  new Response(JSON.stringify({ data: [{ code: "EM_104" }], request_id: "req-123" }), {
    status: 201,
  });
const sentBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

describe("ZeptoMailProvider.send", () => {
  it("POSTs JSON to the region's API with the Zoho-enczapikey token", async () => {
    fetchMock.mockResolvedValue(accepted());
    const result = await newProvider().send({
      from: "sales@tryracko.in",
      fromName: "Sales Team",
      to: "lead@x.com",
      subject: "Hello",
      text: "Plain body",
      html: "<p>Plain body</p>",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.zeptomail.in/v1.1/email");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Zoho-enczapikey ${TOKEN}`);
    expect(sentBody()).toEqual({
      from: { address: "sales@tryracko.in", name: "Sales Team" },
      to: [{ email_address: { address: "lead@x.com" } }],
      reply_to: [{ address: "sales@tryracko.in", name: "Sales Team" }],
      subject: "Hello",
      textbody: "Plain body",
      htmlbody: "<p>Plain body</p>",
      track_clicks: false,
      track_opens: false,
    });
    expect(result).toEqual({ providerMessageId: "req-123", format: "mime" });
  });

  it("makes the HTML from the text when there is none", async () => {
    fetchMock.mockResolvedValue(accepted());
    await newProvider().send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "Hi there" });
    expect(sentBody().htmlbody).toContain("<p>Hi there</p>");
  });

  it("uses the chosen region's host", () => {
    expect(zeptoApiUrl("com")).toBe("https://api.zeptomail.com/v1.1/email");
    expect(zeptoApiUrl("eu")).toBe("https://api.zeptomail.eu/v1.1/email");
  });

  it("429 / 5xx → transient (retried), with Retry-After", async () => {
    fetchMock.mockResolvedValue(
      zeptoError(429, { code: "TM_1001", message: "Too many requests" }, { "retry-after": "30" }),
    );
    const err = await newProvider()
      .send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ kind: "transient", retryAfterSeconds: 30 });
  });

  it("401 → auth (the connection is paused), and the token never appears in the message", async () => {
    fetchMock.mockResolvedValue(
      zeptoError(401, { code: "SERR_157", message: `Invalid API Token found: ${TOKEN}` }),
    );
    const err = (await newProvider()
      .send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" })
      .catch((e: unknown) => e)) as ProviderError;
    expect(err).toMatchObject({ kind: "auth", code: "SERR_157" });
    expect(err.message).not.toContain(TOKEN);
  });

  it("a bad 'to' address → permanent + invalidRecipient (suppressed); a bad sender is not", async () => {
    fetchMock.mockResolvedValueOnce(
      zeptoError(400, { code: "SERR_101", message: "Invalid email address", target: "to" }),
    );
    await expect(
      newProvider().send({ from: "a@b.co", to: "bad@", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ kind: "permanent", invalidRecipient: true });

    fetchMock.mockResolvedValueOnce(
      zeptoError(400, { code: "SERR_101", message: "Invalid email address", target: "from" }),
    );
    await expect(
      newProvider().send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ kind: "permanent", invalidRecipient: false });
  });

  it("network error → transient; no answer in time → plain Error (UNKNOWN_STATE, never re-sent)", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(
      newProvider().send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ kind: "transient", code: "NETWORK" });

    const timeout = Object.assign(new Error("The operation timed out"), { name: "TimeoutError" });
    fetchMock.mockRejectedValueOnce(timeout);
    const err = await newProvider()
      .send({ from: "a@b.co", to: "c@d.co", subject: "s", text: "t" })
      .catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ProviderError);
    expect((err as Error).message).toMatch(/may or may not have been sent/);
  });
});

describe("ZeptoMailProvider.verifyConnection", () => {
  it("sends an EMPTY request (nothing can be sent); refused content = the token works", async () => {
    fetchMock.mockResolvedValue(
      zeptoError(400, { code: "GE_102", message: "Mandatory field missing", target: "from" }),
    );
    await expect(newProvider().verifyConnection()).resolves.toEqual({ ok: true });
    expect(sentBody()).toEqual({});
  });

  it("refused token → not connected, with a hint about the token and region", async () => {
    fetchMock.mockResolvedValue(
      zeptoError(401, { code: "SERR_157", message: "Invalid API Token" }),
    );
    const result = await newProvider("com").verifyConnection();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/refused the token/);
    expect(result.error).toContain("api.zeptomail.com");
  });

  it("a 400 that is about the token is not taken as success", async () => {
    fetchMock.mockResolvedValue(
      zeptoError(400, { code: "SERR_157", message: "Invalid API Token" }),
    );
    await expect(newProvider().verifyConnection()).resolves.toMatchObject({ ok: false });
  });
});

describe("ZeptoMailProvider mailbox reading", () => {
  it("cannot read or list mailboxes: no emails, and a clear message for listing", async () => {
    await expect(newProvider().listReceivedEmails()).resolves.toEqual([]);
    await expect(newProvider().listMailboxes()).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
