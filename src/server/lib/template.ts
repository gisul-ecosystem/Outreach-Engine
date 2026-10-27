// Email template renderer (pure: no database, no I/O).
//
//   {{firstName}}            → the contact's first name ({{first_name}} works too)
//   {{firstName|there}}      → the first name, or "there" when it is empty
//   {{custom.city}}          → a custom CSV column (key as shown on the Contacts page)
//   {{senderName}}           → the sending inbox's signature name ({{senderRole}}, {{senderEmail}})
//   {{originalSubject}}      → in a follow-up: the subject of the first email
//
// Unknown variables and empty values without a fallback become "" and are reported in `missing`
// (and as a warning), so the sender can skip that contact instead of sending "Hi ,".
import { SENDER_VARIABLES, STANDARD_VARIABLES } from "@/shared/campaign";
import { customKey } from "@/shared/contact";

export { SENDER_VARIABLES, STANDARD_VARIABLES };

export type TemplateContact = {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  custom?: Map<string, string> | Record<string, string> | null;
};

/**
 * The sending context: the inbox fills {{senderName}}, {{senderRole}}, {{senderEmail}};
 * for a follow-up, {{originalSubject}} is the subject of the first email in the thread.
 */
export type TemplateSender = {
  name?: string | null;
  role?: string | null;
  email?: string | null;
  originalSubject?: string | null;
};

export type RenderResult = { output: string; warnings: string[]; missing: string[] };

// {{ name }} or {{ name | fallback }} — no braces inside.
const VARIABLE = /\{\{\s*([^{}|]*?)\s*(?:\|([^{}]*))?\}\}/g;

/** "first_name", "First Name" and "firstName" all mean the same variable. */
const squash = (name: string) => name.toLowerCase().replace(/[\s_-]/g, "");
const standardByName = new Map(STANDARD_VARIABLES.map((v) => [squash(v), v]));
const senderByName = new Map(SENDER_VARIABLES.map((v) => [squash(v), v]));

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

function lookup(name: string, contact: TemplateContact, sender: TemplateSender): Lookup {
  const squashed = squash(name);
  if (squashed === "fullname" || squashed === "name") {
    const full = [contact.firstName, contact.lastName]
      .filter(Boolean)
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(" ");
    return { kind: "known", value: full };
  }

  const standard = standardByName.get(squashed);
  if (standard) return { kind: "known", value: (contact[standard] ?? "").trim() };

  const senderField = senderByName.get(squash(name));
  if (senderField) {
    const value = {
      senderName: sender.name,
      senderRole: sender.role,
      senderEmail: sender.email,
      originalSubject: sender.originalSubject,
    }[senderField];
    return { kind: "known", value: (value ?? "").trim() };
  }

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

  // Also accept bare custom keys without "custom." prefix (e.g. {{link}} matching custom.link)
  const custom = contact.custom ?? {};
  const get = (key: string) =>
    custom instanceof Map ? custom.get(key) : (custom as Record<string, string>)[key];
  const directValue = get(name) ?? get(customKey(name));
  if (directValue !== undefined) {
    return { kind: "known", value: directValue.trim() };
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
  options: { html?: boolean; sender?: TemplateSender } = {},
): RenderResult {
  const warnings = new Set<string>();
  const missing = new Set<string>();
  const output = template.replace(VARIABLE, (match, rawName: string, rawFallback?: string) => {
    const name = rawName.trim();
    const hasFallback = rawFallback !== undefined;
    const fallback = (rawFallback ?? "").trim();
    const found = lookup(name, contact, options.sender ?? {});

    let value: string;
    if (found.kind === "unknown") {
      warnings.add(
        name
          ? `{{${name}}} is not a known variable${hasFallback ? ` — "${fallback}" is used instead` : " — it will be left empty"}`
          : `${match} is an empty variable — it will be left empty`,
      );
      if (!hasFallback) missing.add(name || match);
      value = fallback;
    } else if (found.value) {
      value = found.value;
    } else {
      if (!hasFallback) {
        warnings.add(
          `{{${name}}} is empty for ${contact.email} — add a fallback like {{${name}|…}}`,
        );
        missing.add(name);
      }
      value = fallback;
    }
    return options.html ? escapeHtml(value) : value;
  });
  return { output, warnings: [...warnings], missing: [...missing] };
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

/** True for names the renderer understands (standard fields, sender fields and custom.<key>). */
export function isKnownVariable(name: string): boolean {
  const sq = squash(name);
  return (
    sq === "fullname" ||
    sq === "name" ||
    standardByName.has(sq) ||
    senderByName.has(sq) ||
    (name.toLowerCase().startsWith("custom.") && name.length > "custom.".length)
  );
}

export type EmailTemplate = {
  subjectTemplate: string;
  bodyTemplate: string;
  bodyHtml?: string | null;
};

export type RenderedEmail = {
  subject: string;
  text: string;
  html: string | null;
  warnings: string[];
  /** Variables that came out empty (no value, no fallback). Non-empty → do NOT send this email. */
  missing: string[];
};

/** Renders subject, plain-text body and (optional) HTML body for one contact. */
export function renderEmail(
  templates: EmailTemplate,
  contact: TemplateContact,
  sender: TemplateSender = {},
): RenderedEmail {
  const subject = renderTemplate(templates.subjectTemplate, contact, { sender });
  const text = renderTemplate(templates.bodyTemplate, contact, { sender });
  const html = templates.bodyHtml
    ? renderTemplate(templates.bodyHtml, contact, { html: true, sender })
    : null;
  return {
    // A subject is one line: line breaks from values would break the email header.
    subject: subject.output.replace(/[\r\n]+/g, " ").trim(),
    text: text.output,
    html: html?.output ?? null,
    warnings: [...new Set([...subject.warnings, ...text.warnings, ...(html?.warnings ?? [])])],
    missing: [...new Set([...subject.missing, ...text.missing, ...(html?.missing ?? [])])],
  };
}
