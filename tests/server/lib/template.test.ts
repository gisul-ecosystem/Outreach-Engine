import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  isKnownVariable,
  listVariables,
  renderEmail,
  renderTemplate,
  type TemplateContact,
} from "@/server/lib/template";

const ann: TemplateContact = {
  email: "ann@acme.com",
  firstName: "Ann",
  lastName: "Lee",
  company: "Acme",
  title: "CEO",
  custom: new Map([
    ["city", "Pune"],
    ["company_size", "11-50"],
  ]),
};
const empty: TemplateContact = { email: "x@y.com" };

describe("renderTemplate", () => {
  it("replaces every standard variable", () => {
    const r = renderTemplate(
      "{{firstName}} {{lastName}} | {{company}} | {{title}} | {{email}}",
      ann,
    );
    expect(r.output).toBe("Ann Lee | Acme | CEO | ann@acme.com");
    expect(r.warnings).toEqual([]);
  });

  it("replaces custom variables (Map or plain object)", () => {
    expect(renderTemplate("in {{custom.city}}", ann).output).toBe("in Pune");
    expect(
      renderTemplate("{{custom.city}}", { email: "a@b.co", custom: { city: "Delhi" } }).output,
    ).toBe("Delhi");
  });

  it("accepts the original column spelling for custom keys", () => {
    expect(renderTemplate("{{custom.Company Size}}", ann).output).toBe("11-50");
  });

  it("allows spaces inside the braces and is case-insensitive for standard fields", () => {
    expect(renderTemplate("{{ firstName }} / {{FIRSTNAME}}", ann).output).toBe("Ann / Ann");
  });

  it("uses the fallback when the value is empty — without a warning", () => {
    const r = renderTemplate("Hi {{firstName|there}},", empty);
    expect(r.output).toBe("Hi there,");
    expect(r.warnings).toEqual([]);
  });

  it("uses the real value when present, not the fallback", () => {
    expect(renderTemplate("Hi {{firstName|there}}", ann).output).toBe("Hi Ann");
  });

  it("trims the fallback and allows an empty fallback", () => {
    expect(renderTemplate("Hi {{ firstName | my friend }}!", empty).output).toBe("Hi my friend!");
    const r = renderTemplate("Hi{{firstName|}}!", empty);
    expect(r.output).toBe("Hi!");
    expect(r.warnings).toEqual([]);
  });

  it("missing custom value uses the fallback", () => {
    expect(renderTemplate("{{custom.industry|your industry}}", ann).output).toBe("your industry");
  });

  it("empty known value without fallback → empty string + warning", () => {
    const r = renderTemplate("Hi {{firstName}},", empty);
    expect(r.output).toBe("Hi ,");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("{{firstName}} is empty for x@y.com");
  });

  it("unknown variable without fallback → empty string + warning", () => {
    const r = renderTemplate("Hello {{nickname}}!", ann);
    expect(r.output).toBe("Hello !");
    expect(r.warnings).toEqual(["{{nickname}} is not a known variable — it will be left empty"]);
  });

  it("unknown variable with fallback → fallback + warning (likely a typo)", () => {
    const r = renderTemplate("Hi {{frstName|there}}", ann);
    expect(r.output).toBe("Hi there");
    expect(r.warnings[0]).toContain("{{frstName}} is not a known variable");
  });

  it("{{custom.}} and {{}} are unknown", () => {
    expect(renderTemplate("a{{custom.}}b", ann).warnings).toHaveLength(1);
    const r = renderTemplate("a{{}}b", ann);
    expect(r.output).toBe("ab");
    expect(r.warnings).toHaveLength(1);
  });

  it("reports each problem once even when repeated", () => {
    expect(renderTemplate("{{foo}} {{foo}} {{foo}}", ann).warnings).toHaveLength(1);
  });

  it("leaves text without variables and single braces alone", () => {
    expect(renderTemplate("a {b} {{ c", ann).output).toBe("a {b} {{ c");
  });

  it("does not interpret variables inside values (no double rendering)", () => {
    const sneaky = { email: "s@x.io", firstName: "{{email}}" };
    expect(renderTemplate("Hi {{firstName}}", sneaky).output).toBe("Hi {{email}}");
  });

  it("does NOT escape values in plain text", () => {
    const c = { email: "a@b.co", company: "Tom & Jerry <Ltd>" };
    expect(renderTemplate("{{company}}", c).output).toBe("Tom & Jerry <Ltd>");
  });

  it("escapes HTML in values (and fallbacks) when html: true, but keeps the template's HTML", () => {
    const c = { email: "a@b.co", company: `<script>alert("x")</script> & 'co'` };
    const r = renderTemplate("<p>{{company}}</p><b>{{firstName|<there>}}</b>", c, { html: true });
    expect(r.output).toBe(
      "<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;co&#39;</p><b>&lt;there&gt;</b>",
    );
  });
});

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("listVariables", () => {
  it("lists names in order, without duplicates or fallbacks", () => {
    expect(
      listVariables(
        "Hi {{firstName|there}}, {{company}} in {{ custom.city }} — {{firstName}} {{}}",
      ),
    ).toEqual(["firstName", "company", "custom.city"]);
  });

  it("returns [] for a template without variables", () => {
    expect(listVariables("Hello there")).toEqual([]);
  });
});

describe("isKnownVariable", () => {
  it("knows standard fields and custom.<key>", () => {
    expect(isKnownVariable("firstName")).toBe(true);
    expect(isKnownVariable("custom.city")).toBe(true);
    expect(isKnownVariable("custom.")).toBe(false);
    expect(isKnownVariable("nickname")).toBe(false);
  });
});

describe("renderEmail", () => {
  it("renders subject, text and html, merging warnings", () => {
    const r = renderEmail(
      {
        subjectTemplate: "Quick question for {{company}}",
        bodyTemplate: "Hi {{firstName|there}},\n{{nickname}}",
        bodyHtml: "<p>Hi {{firstName}}</p>",
      },
      { ...ann, company: "A&B" },
    );
    expect(r.subject).toBe("Quick question for A&B");
    expect(r.text).toBe("Hi Ann,\n");
    expect(r.html).toBe("<p>Hi Ann</p>");
    expect(r.warnings).toEqual(["{{nickname}} is not a known variable — it will be left empty"]);
  });

  it("html is null without bodyHtml; subject never contains line breaks", () => {
    const r = renderEmail(
      { subjectTemplate: "Hi {{company}}", bodyTemplate: "x" },
      { email: "a@b.co", company: "Line1\nLine2" },
    );
    expect(r.subject).toBe("Hi Line1 Line2");
    expect(r.html).toBeNull();
  });
});
