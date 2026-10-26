import { describe, expect, it } from "vitest";
import { OPT_OUT_LINE } from "@/shared/campaign";
import {
  applyFix,
  checkCampaignContent,
  checkTemplate,
  mustFixMessages,
  summarize,
  type ReadinessContext,
  type ReadinessItem,
  type ReadinessTemplate,
} from "@/shared/readiness";

const GOOD_BODY = `Hi {{firstName|there}},

I noticed your team is hiring engineers and wanted to share how we help similar companies cut their cloud bills by about a third without changing any code.

Would a short call next week be useful?

Best,
{{senderName}}
{{senderRole}}, Racko Technologies

${OPT_OUT_LINE}`;

const good: ReadinessTemplate = {
  subjectTemplate: "Quick question about {{company|your team}}",
  bodyTemplate: GOOD_BODY,
  bodyHtml: null,
};
const ctx: ReadinessContext = {
  isFollowUp: false,
  customVariables: ["custom.city"],
  sendingDomains: ["tryracko.in"],
  emptyFields: {},
};

const check = (over: Partial<ReadinessTemplate> = {}, context: Partial<ReadinessContext> = {}) =>
  checkTemplate({ ...good, ...over }, 0, { ...ctx, ...context });
/** The items of one rule. */
const rule = (items: ReadinessItem[], name: string) => items.filter((i) => i.check === name);
const levelOf = (items: ReadinessItem[], name: string) => {
  const found = rule(items, name);
  if (found.some((i) => i.level === "error")) return "error";
  if (found.some((i) => i.level === "warning")) return "warning";
  return found.length ? "ok" : "none";
};

describe("a well-written email passes everything", () => {
  it("every rule is OK and the score is full", () => {
    const items = check();
    expect(items.filter((i) => i.level !== "ok")).toEqual([]);
    const summary = summarize(items);
    expect(summary.passed).toBe(summary.total);
    expect(summary.total).toBeGreaterThanOrEqual(15);
  });
});

describe("Must fix (blocks Start)", () => {
  it("1. empty subject", () => {
    expect(levelOf(check(), "subject")).toBe("ok");
    const items = check({ subjectTemplate: "  " });
    expect(levelOf(items, "subject")).toBe("error");
    expect(rule(items, "subject")[0].message).toMatch(/subject is empty/);
  });

  it("2. empty body", () => {
    expect(levelOf(check(), "body")).toBe("ok");
    expect(levelOf(check({ bodyTemplate: "" }), "body")).toBe("error");
  });

  it("3. a variable that doesn't exist → 'Did you mean …?' with a one-click fix", () => {
    expect(levelOf(check(), "variables")).toBe("ok");
    const items = check({
      bodyTemplate: GOOD_BODY.replace("{{firstName|there}}", "{{frist_name}}"),
    });
    const [typo] = rule(items, "variables");
    expect(typo.level).toBe("error");
    expect(typo.message).toBe(
      "{{frist_name}} is not a variable we know. Did you mean {{first_name}}?",
    );
    const fix = typo.fixes!.find((f) => f.kind === "replace")!;
    expect(applyFix("Hi {{frist_name}},", fix)).toBe("Hi {{first_name}},");
  });

  it("3. unknown custom column, and {{originalSubject}} in a first email", () => {
    const custom = check({ subjectTemplate: "In {{custom.citty}}" });
    expect(rule(custom, "variables")[0].message).toMatch(
      /no contact in this list has a "citty" column.*\{\{custom\.city\}\}/i,
    );
    const original = check({ subjectTemplate: "{{originalSubject}}" });
    expect(rule(original, "variables")[0].message).toMatch(/only works in a follow-up/);
    expect(
      levelOf(check({ subjectTemplate: "{{originalSubject}}" }, { isFollowUp: true }), "variables"),
    ).toBe("ok");
  });

  it("4. leftover placeholders: [Name], <company>, XXX, TODO, lorem ipsum, single braces", () => {
    expect(levelOf(check(), "placeholders")).toBe("ok");
    for (const leftover of ["[Name]", "<company>", "XXX", "TODO", "Lorem ipsum", "{first_name}"]) {
      const items = check({
        bodyTemplate: GOOD_BODY.replace("Would a short", `${leftover} Would a short`),
      });
      expect(levelOf(items, "placeholders"), leftover).toBe("error");
    }
    const single = rule(check({ subjectTemplate: "Hi {first_name}" }), "placeholders")[0];
    expect(applyFix("Hi {first_name}", single.fixes![0])).toBe("Hi {{first_name}}");
  });

  it("4. an HTML tag is not mistaken for a placeholder", () => {
    expect(levelOf(check({ bodyTemplate: `<p>${GOOD_BODY}</p>` }), "placeholders")).toBe("ok");
  });

  it("5. a first email whose subject starts with RE: or FW:", () => {
    expect(levelOf(check(), "fake-reply")).toBe("ok");
    for (const subject of ["RE: Quick question", "Fw: hello", "fwd:hi"]) {
      expect(levelOf(check({ subjectTemplate: subject }), "fake-reply"), subject).toBe("error");
    }
    const fix = rule(check({ subjectTemplate: "RE: Quick question" }), "fake-reply")[0].fixes![0];
    expect(applyFix("RE: Quick question", fix)).toBe("Quick question");
    expect(
      levelOf(
        check({ subjectTemplate: "Re: {{originalSubject}}" }, { isFollowUp: true }),
        "fake-reply",
      ),
    ).toBe("none");
  });

  it("6. two links, an image, 'see attached', link shorteners and scripts", () => {
    expect(levelOf(check(), "links-images")).toBe("ok");
    const cases: Partial<ReadinessTemplate>[] = [
      { bodyTemplate: `${GOOD_BODY}\nhttps://tryracko.in https://other.com` },
      { bodyHtml: `<p>${GOOD_BODY}</p><img src="https://x/p.gif">` },
      { bodyTemplate: GOOD_BODY.replace("Would", "Please see attached. Would") },
      { bodyTemplate: `${GOOD_BODY}\nhttps://bit.ly/abc` },
      { bodyHtml: `<p>${GOOD_BODY}</p><script>x()</script>` },
      { bodyHtml: `<p>${GOOD_BODY}</p><form></form>` },
      { bodyHtml: `<p>${GOOD_BODY}</p><iframe></iframe>` },
    ];
    for (const over of cases) {
      expect(levelOf(check(over), "links-images"), JSON.stringify(over).slice(-60)).toBe("error");
    }
  });

  it("6. spam words, ALL CAPS and '!!' (as before) — with a plain replacement", () => {
    expect(levelOf(check(), "spam-words")).toBe("ok");
    const items = check({ subjectTemplate: "FREE AMAZING offer!!" });
    const messages = rule(items, "spam-words").map((i) => i.message);
    expect(messages.join(" ")).toMatch(/"FREE" is a spam-trigger word.*"at no charge"/);
    expect(messages.join(" ")).toMatch(/"AMAZING" is in capital letters.*"Amazing"/);
    expect(messages.join(" ")).toMatch(/"!!"/);
    const free = rule(items, "spam-words").find((i) => i.message.includes("FREE"))!;
    expect(applyFix("FREE AMAZING offer!!", free.fixes![0])).toBe("at no charge AMAZING offer!!");
  });

  it("mustFixMessages names the version when there are several", () => {
    const templates = [good, { ...good, name: "Labs", subjectTemplate: "" }];
    const items = checkCampaignContent(templates, ctx);
    expect(mustFixMessages(items, templates)).toEqual([
      '"Labs": Your subject is empty. Write a short, plain subject like a normal email.',
    ]);
  });
});

describe("Warnings (can still start)", () => {
  it("8. no greeting → 'Add it' puts one at the top", () => {
    expect(levelOf(check(), "greeting")).toBe("ok");
    const body = GOOD_BODY.replace("Hi {{firstName|there}},\n\n", "");
    const [item] = rule(check({ bodyTemplate: body }), "greeting");
    expect(item.level).toBe("warning");
    expect(applyFix(body, item.fixes![0]).startsWith("Hi {{firstName|there}},\n\nI noticed")).toBe(
      true,
    );
  });

  it("9. no sign-off → 'Add it' inserts the signature above the opt-out line", () => {
    expect(levelOf(check(), "signature")).toBe("ok");
    const body = `Hi {{firstName|there}},\n\nShort note about costs.\n\n${OPT_OUT_LINE}`;
    const [item] = rule(check({ bodyTemplate: body }), "signature");
    expect(item.message).toBe(
      "Your email has no sign-off with your name. Add a signature like: Best, {{senderName}}",
    );
    expect(applyFix(body, item.fixes![0])).toBe(
      `Hi {{firstName|there}},\n\nShort note about costs.\n\nBest,\n{{senderName}}\n{{senderRole}}\n\n${OPT_OUT_LINE}`,
    );
  });

  it("10. no opt-out line → 'Add it' appends it", () => {
    expect(levelOf(check(), "opt-out")).toBe("ok");
    const body = GOOD_BODY.replace(OPT_OUT_LINE, "");
    const [item] = rule(check({ bodyTemplate: body }), "opt-out");
    expect(item.level).toBe("warning");
    expect(applyFix(body, item.fixes![0]).endsWith(`\n\n${OPT_OUT_LINE}`)).toBe(true);
    expect(levelOf(check({ bodyHtml: "<p>Hi there, a note.</p>" }), "opt-out")).toBe("warning");
  });

  it("11. no company name or address in the signature", () => {
    expect(levelOf(check(), "company")).toBe("ok");
    const body = GOOD_BODY.replace(", Racko Technologies", "");
    expect(levelOf(check({ bodyTemplate: body }), "company")).toBe("warning");
    expect(
      levelOf(
        check({ bodyTemplate: body.replace("{{senderRole}}", "{{senderRole}}, Tryracko") }),
        "company",
      ),
    ).toBe("ok");
  });

  it("12. long subject, emoji", () => {
    expect(levelOf(check(), "subject-style")).toBe("ok");
    const long = "A quick question about how your team handles cloud costs this quarter";
    expect(long.length).toBeGreaterThan(60);
    expect(rule(check({ subjectTemplate: long }), "subject-style")[0].message).toMatch(/under 60/);
    const emoji = rule(check({ subjectTemplate: "Quick idea 🚀" }), "subject-style")[0];
    expect(emoji.level).toBe("warning");
    expect(applyFix("Quick idea 🚀", emoji.fixes![0])).toBe("Quick idea ");
  });

  it("13. too long (>150 words) or too short (<25 words)", () => {
    expect(levelOf(check(), "length")).toBe("ok");
    const long = GOOD_BODY.replace("Would", `${"word ".repeat(160)}Would`);
    expect(rule(check({ bodyTemplate: long }), "length")[0].message).toMatch(/under 150/);
    const short = `Hi {{firstName|there}},\n\nQuick note.\n\nBest,\nSam, Racko Labs\n\n${OPT_OUT_LINE}`;
    expect(rule(check({ bodyTemplate: short }), "length")[0].message).toMatch(/only \d+ words/);
  });

  it("14. a link to another website, or a long machine-made link", () => {
    expect(
      levelOf(check({ bodyTemplate: `${GOOD_BODY}\nhttps://tryracko.in/demo` }), "link-domain"),
    ).toBe("ok");
    expect(
      levelOf(check({ bodyTemplate: `${GOOD_BODY}\nhttps://calendly.com/sam` }), "link-domain"),
    ).toBe("warning");
    const long = `${GOOD_BODY}\nhttps://tryracko.in/landing?utm_source=email&utm_campaign=x`;
    expect(rule(check({ bodyTemplate: long }), "link-domain")[0].message).toMatch(
      /long and looks machine-made/,
    );
  });

  it("15. a variable without fallback that some contacts don't have → count + fallback fix", () => {
    expect(levelOf(check({}, { emptyFields: { company: 12 } }), "fallbacks")).toBe("ok"); // has a fallback
    const items = check({ subjectTemplate: "For {{company}}" }, { emptyFields: { company: 12 } });
    const [item] = rule(items, "fallbacks");
    expect(item.message).toBe(
      "12 contacts have no company — they will be skipped. Add a fallback like {{company|your team}}.",
    );
    expect(applyFix("For {{company}}", item.fixes![0])).toBe("For {{company|your team}}");
  });

  it("16. HTML code in the plain text, or an HTML version that says something else", () => {
    expect(levelOf(check(), "text-vs-html")).toBe("ok");
    expect(
      levelOf(check({ bodyTemplate: GOOD_BODY.replace("Would", "<b>Would</b>") }), "text-vs-html"),
    ).toBe("warning");
    expect(
      levelOf(
        check({ bodyHtml: "<p>Something completely different about cats.</p>" }),
        "text-vs-html",
      ),
    ).toBe("warning");
    const same = `<div>${GOOD_BODY.split("\n").join("<br>")}</div>`;
    expect(levelOf(check({ bodyHtml: same }), "text-vs-html")).toBe("ok");
  });

  it("17. a follow-up whose subject is not {{originalSubject}}", () => {
    const follow = { isFollowUp: true };
    expect(
      levelOf(check({ subjectTemplate: "{{originalSubject}}" }, follow), "follow-up-subject"),
    ).toBe("ok");
    expect(
      levelOf(check({ subjectTemplate: "Re: {{originalSubject}}" }, follow), "follow-up-subject"),
    ).toBe("ok");
    const [item] = rule(check({ subjectTemplate: "Following up" }, follow), "follow-up-subject");
    expect(item.level).toBe("warning");
    expect(applyFix("Following up", item.fixes![0])).toBe("{{originalSubject}}");
    expect(levelOf(check(), "follow-up-subject")).toBe("none"); // not a follow-up
  });
});

describe("every message is one plain sentence (no codes)", () => {
  it("has no error codes or jargon", () => {
    const items = check({
      subjectTemplate: "RE: FREE stuff!! 🚀",
      bodyTemplate: "[Name] {{frist_name}} see attached https://bit.ly/x https://a.com",
      bodyHtml: '<img src="x"><script></script>',
    });
    for (const item of items) {
      expect(item.message).not.toMatch(/[A-Z]{2,}_[A-Z]+|5\.\d\.\d|HTTP \d/);
      expect(item.message.length).toBeLessThan(260);
    }
  });
});
