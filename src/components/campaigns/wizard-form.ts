import {
  DEFAULT_BODY_TEMPLATE,
  minuteToTime,
  WEEKDAYS,
  type CampaignDTO,
  type CampaignVariantInput,
} from "@/shared/campaign";
import { DEFAULTS } from "@/shared/enums";
import type { ReadinessTemplate } from "@/shared/readiness";

/** One version of the email (the main one or an extra one for template rotation). */
export type WizardVariant = CampaignVariantInput;

/** Everything the wizard edits (saved to the draft step by step). */
export type WizardForm = {
  name: string;
  listId: string | null;
  inboxIds: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  /** Own HTML version; null = made from the text automatically. */
  bodyHtml: string | null;
  /** Main template's name (for logs) and the words that pick it. */
  templateName: string;
  matchValues: string[];
  /** Template rotation: the contact field that picks a version, and the extra versions. */
  variantColumn: string;
  variants: WizardVariant[];
  /** Set = this campaign is the follow-up of that one (chosen when it is created). */
  followUpOf: string | null;
  followUpAfterDays: number;
  sendWindow: { startMinute: number; endMinute: number; days: number[] };
};

export function formFromCampaign(campaign?: CampaignDTO | null): WizardForm {
  if (!campaign) {
    return {
      name: "",
      listId: null,
      inboxIds: [],
      subjectTemplate: "",
      bodyTemplate: DEFAULT_BODY_TEMPLATE,
      bodyHtml: null,
      templateName: "",
      matchValues: [],
      variantColumn: "",
      variants: [],
      followUpOf: null,
      followUpAfterDays: 3,
      sendWindow: {
        startMinute: DEFAULTS.sendWindow.startMinute,
        endMinute: DEFAULTS.sendWindow.endMinute,
        days: [...DEFAULTS.sendWindow.days],
      },
    };
  }
  return {
    name: campaign.name,
    listId: campaign.listId,
    inboxIds: campaign.inboxIds,
    subjectTemplate: campaign.subjectTemplate,
    bodyTemplate: campaign.bodyTemplate,
    bodyHtml: campaign.bodyHtml,
    templateName: campaign.templateName,
    matchValues: campaign.matchValues,
    variantColumn: campaign.variantColumn,
    variants: campaign.variants,
    followUpOf: campaign.followUpOf,
    followUpAfterDays: campaign.followUpAfterDays,
    sendWindow: campaign.sendWindow,
  };
}

/** The email fields of the form, as sent to the API. */
export function emailFields(form: WizardForm) {
  return {
    subjectTemplate: form.subjectTemplate,
    bodyTemplate: form.bodyTemplate,
    bodyHtml: form.bodyHtml,
    templateName: form.templateName,
    matchValues: form.matchValues,
    variantColumn: form.variantColumn,
    variants: form.variants,
    followUpAfterDays: form.followUpAfterDays,
  };
}

/** Every version of the email (main first), for the readiness checks. */
export function formTemplates(form: WizardForm): ReadinessTemplate[] {
  return [
    {
      name: form.templateName || form.name,
      subjectTemplate: form.subjectTemplate,
      bodyTemplate: form.bodyTemplate,
      bodyHtml: form.bodyHtml,
    },
    ...form.variants.map((v) => ({
      name: v.name,
      subjectTemplate: v.subjectTemplate,
      bodyTemplate: v.bodyTemplate,
      bodyHtml: v.bodyHtml,
    })),
  ];
}

/** "ai, machine learning , llm" → ["ai", "machine learning", "llm"] */
export function parseWords(text: string): string[] {
  return [
    ...new Set(
      text
        .split(",")
        .map((w) => w.trim())
        .filter(Boolean),
    ),
  ];
}

/** "Mon–Fri 10:00–18:00", "Mon, Wed 09:00–24:00". */
export function describeWindow(window: WizardForm["sendWindow"]): string {
  const days = [...window.days].sort((a, b) => a - b);
  const names = days.map((d) => WEEKDAYS[d - 1].short);
  const consecutive = days.every((d, i) => i === 0 || d === days[i - 1] + 1);
  const dayText =
    days.length === 7
      ? "Every day"
      : consecutive && days.length > 2
        ? `${names[0]}–${names[names.length - 1]}`
        : names.join(", ");
  return `${dayText} ${minuteToTime(window.startMinute)}–${minuteToTime(window.endMinute)}`;
}
