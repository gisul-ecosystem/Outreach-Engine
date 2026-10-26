// Checklist item 10: render a template (text + HTML) with sample data — no {{ or }} may be left over,
// and a contact missing first name or company is reported as missing (so it is skipped, never sent).
// The templates themselves live in the app's database; these are test samples only.
import { describe, expect, it } from "vitest";
import { composeEmail } from "@/server/lib/compose";
import { checkEmailContent } from "@/server/lib/content-check";

const inbox = {
  email: "seller@example.com",
  displayName: "Sam Seller from Acme",
  senderName: "Sam",
  senderRole: "CEO",
};
const contact = { email: "lead@example.com", firstName: "Sandeep", company: "Test Co" };
const OPT_OUT = `If this isn't relevant, just reply "no" and I won't email you again.`;

const firstEmail = {
  subjectTemplate: "Servers for {{company}}",
  bodyTemplate: `Hi {{first_name}},\n\nI saw that {{company}} is growing.\n\nThanks,\n{{senderName}}\n{{senderRole}}, Acme\n\n${OPT_OUT}`,
  bodyHtml: `<div style="font-family: Calibri, Arial, sans-serif; font-size: 15px;">\n  <p>Hi {{first_name}},</p>\n  <p>I saw that {{company}} is growing.</p>\n  <p>Thanks,<br>\n  {{senderName}}<br>\n  {{senderRole}}, Acme<br>\n  <a href="https://example.com">example.com</a></p>\n  <p style="font-size: 12px; color: #888;">${OPT_OUT}</p>\n</div>`,
};
const followUp = {
  subjectTemplate: "Re: {{originalSubject}}",
  bodyTemplate: `Hi {{first_name}},\n\nJust checking if you saw my last email about {{company}}.\n\nThanks,\n{{senderName}}\n\n${OPT_OUT}`,
  bodyHtml: null,
};

describe.each([
  ["first email", firstEmail],
  ["follow-up", followUp],
])("%s template", (_label, template) => {
  const compose = (values: Partial<typeof contact>) =>
    composeEmail({
      template,
      contact: { ...contact, ...values },
      inbox,
      to: contact.email,
      originalSubject: "Servers for Test Co",
    });

  it("renders with sample data: no {{ or }} left, values filled in, both versions", () => {
    const { rendered, input } = compose({});
    for (const part of [rendered.subject, rendered.text, rendered.html ?? ""]) {
      expect(part).not.toMatch(/\{\{|\}\}/);
    }
    expect(rendered.missing).toEqual([]);
    expect(rendered.subject).toContain("Servers for Test Co");
    expect(rendered.text).toMatch(/^Hi Sandeep,/);
    expect(rendered.text).toContain("\nSam\n");
    if (template.bodyHtml) expect(rendered.html).toContain("<p>Hi Sandeep,</p>");
    expect(input.listUnsubscribe).toBe("<mailto:seller@example.com?subject=unsubscribe>");
    expect(input.fromName).toBe("Sam Seller from Acme");
  });

  it("passes the content check", () => {
    expect(checkEmailContent(template).problems).toEqual([]);
  });

  it("reports an empty first name or company instead of sending 'Hi ,'", () => {
    expect(compose({ firstName: "" }).rendered.missing).toContain("first_name");
    expect(compose({ company: " " }).rendered.missing).toContain("company");
  });
});
