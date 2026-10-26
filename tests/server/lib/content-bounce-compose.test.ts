import { describe, expect, it } from "vitest";
import { isAutoReply, isOptOutReply, parseBounce } from "@/server/lib/bounce";
import { campaignTemplates, pickTemplate } from "@/server/lib/compose";
import { checkEmailContent } from "@/server/lib/content-check";
import { clearMxCache, domainAcceptsEmail } from "@/server/lib/mx-check";

const OPT_OUT = "\n\nNot relevant? Just reply 'no' and I won't email again.";
const check = (subjectTemplate: string, bodyTemplate: string, bodyHtml: string | null = null) =>
  checkEmailContent({ subjectTemplate, bodyTemplate: bodyTemplate + OPT_OUT, bodyHtml });

describe("checkEmailContent", () => {
  it("is happy with a normal email", () => {
    expect(
      check("GPU servers for {{company}}", "Hi {{firstName}}, we run GPU servers. See racko.ai"),
    ).toEqual({
      problems: [],
      warnings: [],
    });
  });

  it("blocks spam words, !!, ALL CAPS words, images and more than one link", () => {
    expect(check("FREE trial", "x").problems.join()).toMatch(/"free"/);
    expect(check("s", "100% guaranteed").problems.join()).toMatch(
      /"guaranteed".*"100%"|"100%".*"guaranteed"/,
    );
    expect(check("s", "Act now!!!").problems.join()).toMatch(/act now/);
    expect(check("s", "Wow!!").problems.join()).toMatch(/!!/);
    expect(check("s", "This is AMAZING").problems.join()).toMatch(/ALL CAPS: AMAZING/);
    expect(check("s", "x", '<p>x</p><img src="https://t.co/p.gif">').problems.join()).toMatch(
      /image/,
    );
    expect(check("s", "https://racko.ai and https://other.com").problems.join()).toMatch(
      /2 different links/,
    );
  });

  it("allows short acronyms, one link written twice, and words that only contain a spam word", () => {
    expect(
      check("GPU, GST, A100, RTX", "https://racko.ai — https://www.racko.ai/ — freedom").problems,
    ).toEqual([]);
  });

  it("warns (does not block) when the opt-out line is missing", () => {
    const result = checkEmailContent({ subjectTemplate: "s", bodyTemplate: "Hi" });
    expect(result.problems).toEqual([]);
    expect(result.warnings.join()).toMatch(/opt-out/);
  });
});

describe("parseBounce", () => {
  const exchangeNdr = {
    fromEmail: "postmaster@kanonkode.onmicrosoft.com",
    subject: "Undeliverable: GPU servers in India for Test Co",
    body: [
      "Delivery has failed to these recipients or groups:",
      "lead@example.com",
      "Diagnostic information for administrators:",
      "Remote Server returned '550 5.7.708 Service unavailable. Access denied, traffic not accepted from this IP.'",
      "Original message headers:",
      "From: Sahil <sgoyal@kanonkode.com>",
      "Message-ID: <abc-123@kanonkode.com>",
    ].join("\n"),
  };

  it("reads the code, the reason and the original Message-ID from an Exchange report", () => {
    expect(parseBounce(exchangeNdr)).toEqual({
      code: "5.7.708",
      smtp: "550 5.7.708",
      reason: expect.stringContaining("traffic not accepted from this IP"),
      originalMessageId: "<abc-123@kanonkode.com>",
      addresses: expect.arrayContaining(["lead@example.com", "sgoyal@kanonkode.com"]),
    });
  });

  it("recognises MAILER-DAEMON reports and plain status codes", () => {
    const bounce = parseBounce({
      fromEmail: "mailer-daemon@googlemail.com",
      subject: "Delivery Status Notification (Failure)",
      body: "The email account that you tried to reach does not exist. 550 5.1.1 <x@gmail.com>",
    });
    expect(bounce?.code).toBe("5.1.1");
  });

  it("ignores normal emails and temporary (4.x.x) delay notices", () => {
    expect(
      parseBounce({ fromEmail: "lead@example.com", subject: "Re: GPU", body: "550 5.7.708" }),
    ).toBeNull();
    expect(
      parseBounce({
        fromEmail: "postmaster@x.com",
        subject: "Delivery has failed",
        body: "451 4.4.7 delayed",
      }),
    ).toBeNull();
  });
});

describe("replies", () => {
  it("spots auto-replies and 'no' replies", () => {
    expect(isAutoReply({ subject: "Automatic reply: GPU servers" })).toBe(true);
    expect(isAutoReply({ subject: "Re: GPU servers" })).toBe(false);
    expect(
      isOptOutReply({ subject: "Re: x", uniqueBody: "\n No thanks.\n\nOn Mon ... wrote:" }),
    ).toBe(true);
    expect(isOptOutReply({ subject: "Re: x", uniqueBody: "Not now, maybe next quarter" })).toBe(
      false,
    );
    expect(isOptOutReply({ subject: "Re: x", uniqueBody: "Sure, send the comparison" })).toBe(
      false,
    );
  });
});

describe("template rotation", () => {
  const campaign = {
    name: "Oct",
    templateName: "GPU",
    subjectTemplate: "g",
    bodyTemplate: "g",
    matchValues: ["ai", "machine learning"],
    variantColumn: "custom.segment",
    variants: [
      {
        name: "Labs",
        subjectTemplate: "l",
        bodyTemplate: "l",
        matchValues: ["training", "edtech"],
      },
    ],
  };
  const templates = campaignTemplates(campaign);
  const pick = (segment: string, turn = 0) =>
    pickTemplate(templates, campaign.variantColumn, { email: "a@b.c", custom: { segment } }, turn);

  it("picks by whole word in the column, otherwise takes turns", () => {
    expect(templates.map((t) => t.name)).toEqual(["GPU", "Labs"]);
    expect(pick("AI startup")).toEqual({ index: 0, matched: true });
    expect(pick("Corporate Training")).toEqual({ index: 1, matched: true });
    expect(pick("EdTech")).toEqual({ index: 1, matched: true });
    expect(pick("retail", 0)).toEqual({ index: 0, matched: false }); // "ai" inside "retail" does not count
    expect(pick("", 1)).toEqual({ index: 1, matched: false });
  });

  it("a campaign without variants always uses its one template", () => {
    expect(pickTemplate(campaignTemplates({ name: "x" }), "", { email: "a@b.c" }, 5)).toEqual({
      index: 0,
      matched: true,
    });
  });
});

describe("domainAcceptsEmail (MX check)", () => {
  it("false only when the domain certainly has no mail server", async () => {
    clearMxCache();
    expect(await domainAcceptsEmail("good.test", async () => [{ exchange: "mx.good.test" }])).toBe(
      true,
    );
    expect(await domainAcceptsEmail("nullmx.test", async () => [{ exchange: "." }])).toBe(false);
    const notFound = Object.assign(new Error("x"), { code: "ENOTFOUND" });
    expect(await domainAcceptsEmail("gone.test", async () => Promise.reject(notFound))).toBe(false);
    const timeout = Object.assign(new Error("x"), { code: "ETIMEOUT" });
    expect(await domainAcceptsEmail("slow.test", async () => Promise.reject(timeout))).toBe(true);
  });
});
