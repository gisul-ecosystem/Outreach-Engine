// One test per bot rule: a case that triggers it and a case that does not.
import { describe, expect, it } from "vitest";
import { classifyClick, type ClickSignals } from "@/server/tracking/classify-click";
import { knownScanner } from "@/server/tracking/scanners";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";

/** A normal person clicking in Edge, 2 hours after the email was sent. */
const person: ClickSignals = {
  method: "GET",
  userAgent: CHROME,
  hasAcceptLanguage: true,
  hasSecFetch: true,
  secondsSinceSent: 7200,
  recentSameLink: 1,
  otherContactsSameVisitor: 0,
};
const codes = (s: Partial<ClickSignals>) =>
  classifyClick({ ...person, ...s }).reasons.map((r) => r.code);

describe("classifyClick", () => {
  it("a normal browser click is a real click, with a plain-English reason", () => {
    expect(classifyClick(person)).toEqual({
      verdict: "click",
      reasons: [{ code: "looks-human", text: "Looks like a real person." }],
    });
  });

  it("HEAD request → bot; GET → not", () => {
    expect(classifyClick({ ...person, method: "HEAD" }).verdict).toBe("bot");
    expect(codes({ method: "HEAD" })).toContain("head-request");
    expect(codes({ method: "GET" })).not.toContain("head-request");
  });

  it("empty user agent → bot", () => {
    expect(classifyClick({ ...person, userAgent: "  " }).verdict).toBe("bot");
    expect(codes({ userAgent: "" })).toContain("no-user-agent");
  });

  it("known scanner / link preview / script → bot, naming it", () => {
    const curl = classifyClick({ ...person, userAgent: "curl/8.9.1" });
    expect(curl.verdict).toBe("bot");
    expect(curl.reasons[0].text).toBe("Known scanner or link preview: curl.");
    expect(classifyClick({ ...person, userAgent: "ReactorNetty/1.0.4" }).reasons[0].text).toContain(
      "Avanan",
    );
    expect(
      classifyClick({
        ...person,
        userAgent: "Mozilla/5.0 (compatible; LinkedInBot/1.0; +http://www.linkedin.com)",
      }).verdict,
    ).toBe("bot");
    expect(knownScanner(CHROME)).toBeNull();
  });

  it("a user agent that is not a browser → bot", () => {
    expect(codes({ userAgent: "SomeChecker 2.0" })).toContain("not-a-browser");
    expect(codes({ userAgent: CHROME })).not.toContain("not-a-browser");
  });

  it("opened within 60 s of sending → maybe a bot; later or unknown → not", () => {
    const fast = classifyClick({ ...person, secondsSinceSent: 4 });
    expect(fast.verdict).toBe("suspicious");
    expect(fast.reasons[0].text).toBe(
      "Probably a security scanner: opened 4 seconds after sending.",
    );
    expect(codes({ secondsSinceSent: 61 })).not.toContain("too-fast");
    expect(codes({ secondsSinceSent: null })).not.toContain("too-fast");
  });

  it("3+ opens of the same link within 10 s → maybe a bot", () => {
    expect(classifyClick({ ...person, recentSameLink: 3 }).verdict).toBe("suspicious");
    expect(codes({ recentSameLink: 2 })).not.toContain("burst");
  });

  it("the same visitor opened 2+ other people's links → maybe a bot", () => {
    expect(classifyClick({ ...person, otherContactsSameVisitor: 2 }).verdict).toBe("suspicious");
    expect(codes({ otherContactsSameVisitor: 1 })).not.toContain("many-people");
  });

  it("no Accept-Language → maybe a bot", () => {
    expect(classifyClick({ ...person, hasAcceptLanguage: false }).verdict).toBe("suspicious");
    expect(codes({ hasAcceptLanguage: true })).not.toContain("no-language");
  });

  it("claims Chrome/Edge/Firefox without Sec-Fetch headers → maybe a bot; Safari is not judged by it", () => {
    expect(classifyClick({ ...person, hasSecFetch: false }).verdict).toBe("suspicious");
    const safari =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(codes({ userAgent: safari, hasSecFetch: false })).not.toContain("no-sec-fetch");
  });

  it("a bot reason wins over suspicious ones, and all reasons are kept", () => {
    const result = classifyClick({ ...person, method: "HEAD", secondsSinceSent: 2 });
    expect(result.verdict).toBe("bot");
    expect(result.reasons.map((r) => r.code)).toEqual(["head-request", "too-fast"]);
  });
});
