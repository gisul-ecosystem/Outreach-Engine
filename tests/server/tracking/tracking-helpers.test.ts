import { describe, expect, it } from "vitest";
import { clientIp, hashIp } from "@/server/tracking/client-ip";
import { allowedDestination } from "@/server/tracking/destination";
import { allowClick, RATE_LIMIT, resetRateLimit } from "@/server/tracking/rate-limit";
import { findLinkTokens, isTokenFormat, linkUrl, newToken } from "@/server/tracking/token";

describe("tokens", () => {
  it("are 12 URL-safe random characters, all different", () => {
    const tokens = Array.from({ length: 1000 }, newToken);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(new Set(tokens).size).toBe(1000);
  });

  it("checks the format", () => {
    expect(isTokenFormat("k7f2Qa9xLm_3")).toBe(true);
    expect(isTokenFormat("short")).toBe(false);
    expect(isTokenFormat("../../etc/passwd")).toBe(false);
  });

  it("builds the link from the base address", () => {
    expect(linkUrl("https://go.racko.ai/", "k7f2Qa9xLm_3")).toBe(
      "https://go.racko.ai/r/k7f2Qa9xLm_3",
    );
  });

  it("finds tokens in an email body (HTML or text), once each", () => {
    const body = `<p>Hi, <a href="https://go.racko.ai/r/k7f2Qa9xLm_3">take a look</a>.
      Again: http://localhost:3000/r/k7f2Qa9xLm_3 and https://other.com/r/AbCdEfGhIjKl</p>
      <a href="https://racko.ai/pricing">no token</a> /r/tooshort`;
    expect(findLinkTokens(body)).toEqual(["k7f2Qa9xLm_3", "AbCdEfGhIjKl"]);
  });
});

describe("allowedDestination (stops open redirects)", () => {
  const hosts = ["racko.ai", "www.racko.ai"];
  it("accepts https on an allowed host, with any path", () => {
    expect(allowedDestination("https://racko.ai", hosts)).toBe("https://racko.ai/");
    expect(allowedDestination("https://www.racko.ai/pricing?x=1#top", hosts)).toBe(
      "https://www.racko.ai/pricing?x=1#top",
    );
  });

  it.each([
    "http://racko.ai/",
    "https://evil.com/",
    "https://racko.ai.evil.com/",
    "https://evilracko.ai/",
    "https://racko.ai@evil.com/",
    "https://user:pass@racko.ai/",
    "https://racko.ai:8443/",
    "javascript:alert(1)",
    "not a url",
  ])("refuses %s", (url) => {
    expect(allowedDestination(url, hosts)).toBeNull();
  });
});

describe("visitor IP", () => {
  const headers = (h: Record<string, string>) => new Headers(h);

  it("without a trusted proxy: the last X-Forwarded-For entry", () => {
    expect(clientIp(headers({ "x-forwarded-for": "1.1.1.1, 203.0.113.7" }), false)).toBe(
      "203.0.113.7",
    );
    expect(clientIp(headers({ "cf-connecting-ip": "9.9.9.9" }), false)).toBeNull();
  });

  it("behind a trusted proxy: CF-Connecting-IP / X-Real-IP first", () => {
    expect(
      clientIp(headers({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" }), true),
    ).toBe("9.9.9.9");
    expect(clientIp(headers({ "x-real-ip": "8.8.8.8" }), true)).toBe("8.8.8.8");
  });

  it("is scrambled with HMAC: same IP → same code, the IP is not in it, another key → other code", () => {
    const a = hashIp("203.0.113.7", "secret-one-secret-one-secret-one-1");
    expect(a).toBe(hashIp("203.0.113.7", "secret-one-secret-one-secret-one-1"));
    expect(a).not.toContain("203");
    expect(a).not.toBe(hashIp("203.0.113.7", "secret-two-secret-two-secret-two-2"));
    expect(a).not.toBe(hashIp("203.0.113.8", "secret-one-secret-one-secret-one-1"));
  });
});

describe("rate limit", () => {
  it(`allows ${RATE_LIMIT} per visitor per minute, then refuses until the minute is over`, () => {
    resetRateLimit();
    const t = 1_000_000;
    for (let i = 0; i < RATE_LIMIT; i++) expect(allowClick("v", t + i)).toBe(true);
    expect(allowClick("v", t + 100)).toBe(false);
    expect(allowClick("other", t + 100)).toBe(true);
    expect(allowClick("v", t + 60_000)).toBe(true);
  });
});
