import { DEFAULT_BODY_TEMPLATE, minuteToTime, WEEKDAYS, type CampaignDTO } from "@/shared/campaign";
import { DEFAULTS } from "@/shared/enums";

/** Everything the wizard edits (saved to the draft step by step). */
export type WizardForm = {
  name: string;
  listId: string | null;
  inboxIds: string[];
  subjectTemplate: string;
  bodyTemplate: string;
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
    sendWindow: campaign.sendWindow,
  };
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
