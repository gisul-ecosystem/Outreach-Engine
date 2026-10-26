// Turns a campaign template + contact + sending inbox into the email to send (pure: no database, no I/O).
// The worker, the preview and the test-send script all use this, so they build exactly the same email.
import type { SendInput } from "@/server/providers/types";
import { customKey } from "@/shared/contact";
import { newMessageId } from "./mime";
import {
  renderEmail,
  type EmailTemplate,
  type RenderedEmail,
  type TemplateContact,
  type TemplateSender,
} from "./template";

export type NamedTemplate = EmailTemplate & { name: string; matchValues: string[] };

/** The campaign fields that hold its template(s). */
export type CampaignTemplates = {
  name: string;
  templateName?: string | null;
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
  bodyHtml?: string | null;
  variantColumn?: string | null;
  matchValues?: string[] | null;
  variants?:
    | {
        name: string;
        subjectTemplate?: string | null;
        bodyTemplate?: string | null;
        bodyHtml?: string | null;
        matchValues?: string[] | null;
      }[]
    | null;
};

/** All versions of the campaign's email: index 0 is the main template, then the variants. */
export function campaignTemplates(campaign: CampaignTemplates): NamedTemplate[] {
  return [
    {
      name: campaign.templateName || campaign.name,
      subjectTemplate: campaign.subjectTemplate ?? "",
      bodyTemplate: campaign.bodyTemplate ?? "",
      bodyHtml: campaign.bodyHtml || null,
      matchValues: [...(campaign.matchValues ?? [])],
    },
    ...(campaign.variants ?? []).map((v) => ({
      name: v.name,
      subjectTemplate: v.subjectTemplate ?? "",
      bodyTemplate: v.bodyTemplate ?? "",
      bodyHtml: v.bodyHtml || null,
      matchValues: [...(v.matchValues ?? [])],
    })),
  ];
}

/** A contact's value for a column name like "title", "company" or "custom.segment". */
export function contactField(contact: TemplateContact, column: string): string {
  const name = column.trim();
  if (name.toLowerCase().startsWith("custom.")) {
    const key = name.slice("custom.".length);
    const custom = contact.custom ?? {};
    const get = (k: string) =>
      custom instanceof Map ? custom.get(k) : (custom as Record<string, string>)[k];
    return (get(key) ?? get(customKey(key)) ?? "").trim();
  }
  const standard: Record<string, string | null | undefined> = {
    firstname: contact.firstName,
    lastname: contact.lastName,
    company: contact.company,
    title: contact.title,
    email: contact.email,
  };
  return (standard[name.toLowerCase().replace(/[\s_-]/g, "")] ?? "").trim();
}

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Template rotation: which version this contact gets.
 * A version whose matchValues contain a whole word of the contact's column value wins
 * (e.g. "ai" matches "AI startup" but not "retail"). No match → `unmatchedTurn` picks one in turn.
 */
export function pickTemplate(
  templates: NamedTemplate[],
  column: string | null | undefined,
  contact: TemplateContact,
  unmatchedTurn: number,
): { index: number; matched: boolean } {
  if (templates.length <= 1) return { index: 0, matched: true };
  const value = column ? contactField(contact, column) : "";
  if (value) {
    const index = templates.findIndex((t) =>
      t.matchValues.some(
        (word) => word.trim() && new RegExp(`\\b${escapeRegex(word.trim())}\\b`, "i").test(value),
      ),
    );
    if (index >= 0) return { index, matched: true };
  }
  return { index: unmatchedTurn % templates.length, matched: false };
}

export type SendingInbox = {
  email: string;
  displayName?: string | null;
  senderName?: string | null;
  senderRole?: string | null;
};

/** Signature values for {{senderName}} / {{senderRole}} / {{senderEmail}}. */
export function senderOf(inbox: SendingInbox): TemplateSender {
  return {
    name: inbox.senderName || inbox.displayName || "",
    role: inbox.senderRole ?? "",
    email: inbox.email,
  };
}

/** mailto: opt-out link for the List-Unsubscribe header (mail apps show an "Unsubscribe" button). */
export function listUnsubscribeFor(inboxEmail: string): string {
  return `<mailto:${inboxEmail}?subject=unsubscribe>`;
}

/**
 * Renders the template for this contact and builds the provider input.
 * If `rendered.missing` is not empty, the email must NOT be sent (it would say "Hi ," or "for ,").
 */
export function composeEmail(args: {
  template: EmailTemplate;
  contact: TemplateContact;
  inbox: SendingInbox;
  to: string;
  /** Message-ID of the first email, for a follow-up in the same thread. */
  inReplyTo?: string | null;
  /** The provider's id of the first email (Outlook format replies to it). */
  parentProviderMessageId?: string | null;
  /** Subject of the first email, for {{originalSubject}} in a follow-up. */
  originalSubject?: string | null;
  messageId?: string;
}): { rendered: RenderedEmail; input: SendInput } {
  const rendered = renderEmail(args.template, args.contact, {
    ...senderOf(args.inbox),
    originalSubject: args.originalSubject,
  });
  const input: SendInput = {
    from: args.inbox.email,
    fromName: args.inbox.displayName || undefined,
    to: args.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html ?? undefined,
    messageId: args.messageId ?? newMessageId(args.inbox.email),
    inReplyTo: args.inReplyTo ?? undefined,
    parentProviderMessageId: args.parentProviderMessageId ?? undefined,
    listUnsubscribe: listUnsubscribeFor(args.inbox.email),
  };
  return { rendered, input };
}
