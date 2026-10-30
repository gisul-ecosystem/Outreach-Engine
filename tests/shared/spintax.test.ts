// Spintax: {a|b|c} picks one option per person — fixed per person, different across people.
import { describe, expect, it } from "vitest";
import { renderEmail } from "@/server/lib/template";
import { applyFix, checkTemplate, type ReadinessContext } from "@/shared/readiness";
import { countSpinVersions, hasSpintax, resolveSpintax, spintaxProblems } from "@/shared/spintax";

const people = Array.from({ length: 60 }, (_, i) => `person${i}@example.com`);

describe("resolveSpintax", () => {
  it("picks one option, always the same one for the same person", () => {
    const out = resolveSpintax("{Hi|Hello|Hey} there", "a@x.com");
    expect(["Hi there", "Hello there", "Hey there"]).toContain(out);
    expect(resolveSpintax("{Hi|Hello|Hey} there", "A@X.com")).toBe(out);
  });

  it("spreads the options across people", () => {
    const seen = new Set(people.map((p) => resolveSpintax("{Hi|Hello|Hey}", p)));
    expect(seen).toEqual(new Set(["Hi", "Hello", "Hey"]));
  });

  it("leaves {{variables}} (and their | fallbacks) for the renderer", () => {
    expect(resolveSpintax("{{firstName|there}}", "a@x.com")).toBe("{{firstName|there}}");
    expect(["Hi {{firstName|there}}", "Yo"]).toContain(
      resolveSpintax("{Hi {{firstName|there}}|Yo}", "a@x.com"),
    );
  });

  it("supports nested groups, empty options, and ignores braces without |", () => {
    const outs = new Set(people.map((p) => resolveSpintax("{a|{b|c}}", p)));
    expect([...outs].every((o) => ["a", "b", "c"].includes(o))).toBe(true);
    expect(new Set(people.map((p) => resolveSpintax("{quick |}call", p)))).toEqual(
      new Set(["quick call", "call"]),
    );
    const css = "p { color: red; } {x}";
    expect(resolveSpintax(css, "a@x.com")).toBe(css);
    expect(hasSpintax(css)).toBe(false);
  });
});

describe("countSpinVersions and spintaxProblems", () => {
  it("multiplies groups and adds nested options", () => {
    expect(countSpinVersions("plain {{firstName|there}}")).toBe(1);
    expect(countSpinVersions("{a|b|c} {d|e}")).toBe(6);
    expect(countSpinVersions("{a|{b|c}} {d|e}")).toBe(6);
  });

  it("reports unbalanced braces outside variables", () => {
    expect(spintaxProblems("{Hi|Hello there")).toHaveLength(1);
    expect(spintaxProblems("Hi|Hello} there")).toHaveLength(1);
    expect(spintaxProblems("{Hi|Hello} {{firstName|there}}")).toEqual([]);
  });
});

describe("renderEmail with spintax", () => {
  const template = {
    subjectTemplate: "{Quick question|Idea} for {{company|your team}}",
    bodyTemplate: "{Hi|Hello|Hey} {{firstName|there}},\n\n{I saw|I noticed} your post.",
    bodyHtml: "<p>{Hi|Hello|Hey} {{firstName|there}},</p><p>{I saw|I noticed} your post.</p>",
  };

  it("renders variables inside the chosen option; text and HTML say the same words", () => {
    for (const email of people.slice(0, 20)) {
      const out = renderEmail(template, { email, firstName: "Asha", company: "Acme" });
      expect(out.subject).toMatch(/^(Quick question|Idea) for Acme$/);
      expect(out.text).toMatch(/^(Hi|Hello|Hey) Asha,\n\n(I saw|I noticed) your post\.$/);
      expect(out.html).toBe(
        `<p>${out.text.split("\n\n")[0]}</p><p>${out.text.split("\n\n")[1]}</p>`,
      );
      expect(out.missing).toEqual([]);
    }
  });

  it("a variable only in an option the person did not get is not 'missing'", () => {
    const tpl = { subjectTemplate: "Hi", bodyTemplate: "{{{company}}|there}" };
    const results = people.map((email) => renderEmail(tpl, { email }));
    expect(results.some((r) => r.missing.length === 0 && r.text === "there")).toBe(true);
    expect(results.some((r) => r.missing.includes("company"))).toBe(true);
  });
});

describe("readiness: wording variety", () => {
  const ctx: ReadinessContext = {
    isFollowUp: false,
    customVariables: [],
    sendingDomains: ["tryracko.in"],
    emptyFields: {},
  };
  const spin = (subjectTemplate: string, bodyTemplate: string) =>
    checkTemplate({ subjectTemplate, bodyTemplate, bodyHtml: null }, 0, ctx).filter(
      (i) => i.check === "spintax",
    );

  it("ok with the number of wordings when spintax is used", () => {
    expect(spin("{Hi|Hello}", "{a|b|c} text")).toEqual([
      expect.objectContaining({ level: "ok", message: expect.stringContaining("6 different") }),
    ]);
  });

  it("suggests spintax (with a one-click greeting fix) when every email is the same", () => {
    const [item] = spin("Hello", "Hi Asha,\n\nText.");
    expect(item.level).toBe("warning");
    expect(applyFix("Hi Asha,\n\nText.", item.fixes![0])).toBe("{Hi|Hello|Hey} Asha,\n\nText.");
  });

  it("a spun greeting still counts as a greeting", () => {
    const items = checkTemplate(
      { subjectTemplate: "Hello", bodyTemplate: "{Hi|Hello} Asha,\n\nText.", bodyHtml: null },
      0,
      ctx,
    );
    expect(items.filter((i) => i.check === "greeting").every((i) => i.level === "ok")).toBe(true);
  });

  it("spam words in any option are caught", () => {
    const items = checkTemplate(
      { subjectTemplate: "Hello", bodyTemplate: "{Hi|Act now} Asha,\n\nText.", bodyHtml: null },
      0,
      ctx,
    );
    expect(items.some((i) => i.check === "spam-words" && i.level === "error")).toBe(true);
  });

  it("must-fix for a broken group", () => {
    expect(spin("Hello", "{Hi|Hello Asha")[0].level).toBe("error");
  });
});
