// Email template renderer (pure: no database, no I/O).
//
//   {{firstName}}            → the contact's first name
//   {{firstName|there}}      → the first name, or "there" when it is empty
//   {{custom.city}}          → a custom CSV column (key as shown on the Contacts page)
//
// Unknown variables and empty values without a fallback become "" and produce a warning,
// so the preview can show what would look wrong before anything is sent.
import { STANDARD_VARIABLES } from "@/shared/campaign";
import { customKey } from "@/shared/contact";

export { STANDARD_VARIABLES };

export type TemplateContact = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  custom?: Map<string, string> | Record<string, string> | null;
};

export type RenderResult = { output: string; warnings: string[] };

// {{ name }} or {{ name | fallback }} — no braces inside.
const VARIABLE = /\{\{\s*([^{}|]*?)\s*(?:\|([^{}]*))?\}\}/g;

const standardByLowerCase = new Map(STANDARD_VARIABLES.map((v) => [v.toLowerCase(), v]));

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type Lookup =
  | { kind: "known"; value: string } // value may be "" (known variable, empty for this contact)
  | { kind: "unknown" };

function lookup(name: string, contact: TemplateContact): Lookup {
  const standard = standardByLowerCase.get(name.toLowerCase());
  if (standard) return { kind: "known", value: (contact[standard] ?? "").trim() };

  if (name.toLowerCase().startsWith("custom.")) {
    const raw = name.slice("custom.".length);
    if (!raw) return { kind: "unknown" };
    const custom = contact.custom ?? {};
    const get = (key: string) =>
      custom instanceof Map ? custom.get(key) : (custom as Record<string, string>)[key];
    // Custom keys are stored lowercase with "_" ("Company Size" → company_size); accept either spelling.
    const value = get(raw) ?? get(customKey(raw)) ?? "";
    return { kind: "known", value: value.trim() };
  }
  return { kind: "unknown" };
}

/**
 * Replaces every {{variable}} in the template with the contact's value.
 * `html: true` escapes the inserted values (the template's own HTML is kept as written).
 */
export function renderTemplate(
  template: string,
  contact: TemplateContact,
  options: { html?: boolean } = {},
): RenderResult {
  const warnings = new Set<string>();
  const output = template.replace(VARIABLE, (match, rawName: string, rawFallback?: string) => {
    const name = rawName.trim();
    const hasFallback = rawFallback !== undefined;
    const fallback = (rawFallback ?? "").trim();
    const found = lookup(name, contact);

    let value: string;
    if (found.kind === "unknown") {
      warnings.add(
        name
          ? `{{${name}}} is not a known variable${hasFallback ? ` — "${fallback}" is used instead` : " — it will be left empty"}`
          : `${match} is an empty variable — it will be left empty`,
      );
      value = fallback;
    } else if (found.value) {
      value = found.value;
    } else {
      if (!hasFallback) {
        warnings.add(
          `{{${name}}} is empty for ${contact.email} — add a fallback like {{${name}|…}}`,
        );
      }
      value = fallback;
    }
    return options.html ? escapeHtml(value) : value;
  });
  return { output, warnings: [...warnings] };
}

/** Variable names used in a template, in order of first appearance, without duplicates. */
export function listVariables(template: string): string[] {
  const names = new Set<string>();
  for (const match of template.matchAll(VARIABLE)) {
    const name = match[1].trim();
    if (name) names.add(name);
  }
  return [...names];
}

/** True for names the renderer understands (standard fields and custom.<key>). */
export function isKnownVariable(name: string): boolean {
  return (
    standardByLowerCase.has(name.toLowerCase()) ||
    (name.toLowerCase().startsWith("custom.") && name.length > "custom.".length)
  );
}

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string | null;
  warnings: string[];
};

/** Renders subject, plain-text body and (optional) HTML body for one contact. */
export function renderEmail(
  templates: { subjectTemplate: string; bodyTemplate: string; bodyHtml?: string | null },
  contact: TemplateContact,
): RenderedEmail {
  const subject = renderTemplate(templates.subjectTemplate, contact);
  const text = renderTemplate(templates.bodyTemplate, contact);
  const html = templates.bodyHtml
    ? renderTemplate(templates.bodyHtml, contact, { html: true })
    : null;
  return {
    // A subject is one line: line breaks from values would break the email header.
    subject: subject.output.replace(/[\r\n]+/g, " ").trim(),
    text: text.output,
    html: html?.output ?? null,
    warnings: [...new Set([...subject.warnings, ...text.warnings, ...(html?.warnings ?? [])])],
  };
}
