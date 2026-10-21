"use client";

import { PlayIcon, SaveIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/utils";
import { sendWindowSchema, type CampaignDTO, type UpdateCampaignInput } from "@/shared/campaign";
import {
  useCampaign,
  useCampaignStats,
  useCreateCampaign,
  useStartCampaign,
  useUpdateCampaign,
} from "./use-campaigns";
import { formFromCampaign, type WizardForm } from "./wizard-form";
import { WizardStepBasics } from "./wizard-step-basics";
import { WizardStepEmail } from "./wizard-step-email";
import { WizardStepInboxes } from "./wizard-step-inboxes";
import { WizardStepReview } from "./wizard-step-review";
import { WizardStepWindow } from "./wizard-step-window";

const STEPS = ["Name & list", "Inboxes", "Write email", "Send window", "Review"] as const;
type Step = 0 | 1 | 2 | 3 | 4;

/** What is missing on a step before Next (null = fine). */
function stepError(step: Step, form: WizardForm): string | null {
  if (step === 0) {
    if (!form.name.trim()) return "Enter a campaign name";
    if (!form.listId) return "Choose a contact list";
  }
  if (step === 1 && form.inboxIds.length === 0) return "Choose at least one inbox";
  if (step === 2) {
    if (!form.subjectTemplate.trim()) return "Write a subject";
    if (!form.bodyTemplate.trim()) return "Write the email";
  }
  if (step === 3) {
    const check = sendWindowSchema.safeParse(form.sendWindow);
    if (!check.success) return check.error.issues[0].message;
  }
  return null;
}

/**
 * Create / edit wizard. The draft is created after step 1 and saved on every "Next",
 * so nothing is lost when the page is closed. Start happens on the review step.
 */
export function CampaignWizard({ campaign }: { campaign?: CampaignDTO }) {
  const router = useRouter();
  const [campaignId, setCampaignId] = useState<string | null>(campaign?.id ?? null);
  const [step, setStep] = useState<Step>(0);
  const [form, setForm] = useState<WizardForm>(() => formFromCampaign(campaign));
  const [confirmStart, setConfirmStart] = useState(false);

  const saved = useCampaign(campaignId);
  const stats = useCampaignStats(campaignId);
  const create = useCreateCampaign();
  const update = useUpdateCampaign();
  const start = useStartCampaign();

  const status = saved.data?.status ?? campaign?.status ?? "draft";
  const isDraft = status === "draft";
  const busy = create.isPending || update.isPending || start.isPending;
  const patch = (p: Partial<WizardForm>) => setForm((f) => ({ ...f, ...p }));

  /** Saves the fields of one step. Step 1 creates the draft the first time. */
  async function saveStep(s: Step) {
    if (s === 0 && !campaignId) {
      const created = await create.mutateAsync({ name: form.name, listId: form.listId! });
      setCampaignId(created.id);
      // Same URL as "edit", so a page refresh keeps working on this draft.
      window.history.replaceState(null, "", `/campaigns/${created.id}/edit`);
      return;
    }
    if (!campaignId) return;
    const fields: Record<Step, UpdateCampaignInput> = {
      0: { name: form.name, ...(isDraft ? { listId: form.listId! } : {}) },
      1: { inboxIds: form.inboxIds },
      2: { subjectTemplate: form.subjectTemplate, bodyTemplate: form.bodyTemplate },
      3: { sendWindow: form.sendWindow },
      4: {},
    };
    if (Object.keys(fields[s]).length) await update.mutateAsync({ id: campaignId, ...fields[s] });
  }

  async function next() {
    const error = stepError(step, form);
    if (error) return toast.error(error);
    try {
      await saveStep(step);
      setStep((s) => Math.min(4, s + 1) as Step);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  /** Saves whatever is valid so far and goes back to the campaigns list. */
  async function saveAndExit() {
    try {
      if (!campaignId) {
        if (form.name.trim() && form.listId) {
          await create.mutateAsync({
            name: form.name,
            listId: form.listId,
            inboxIds: form.inboxIds,
            subjectTemplate: form.subjectTemplate,
            bodyTemplate: form.bodyTemplate,
          });
          toast.success("Draft saved");
        }
      } else {
        await update.mutateAsync({
          id: campaignId,
          ...(form.name.trim() ? { name: form.name } : {}),
          ...(isDraft && form.listId ? { listId: form.listId } : {}),
          inboxIds: form.inboxIds,
          subjectTemplate: form.subjectTemplate,
          bodyTemplate: form.bodyTemplate,
          ...(sendWindowSchema.safeParse(form.sendWindow).success
            ? { sendWindow: form.sendWindow }
            : {}),
        });
        toast.success(isDraft ? "Draft saved" : "Changes saved");
      }
      router.push(campaignId && !isDraft ? `/campaigns/${campaignId}` : "/campaigns");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function startNow() {
    if (!campaignId) return;
    try {
      await start.mutateAsync(campaignId);
      setConfirmStart(false);
      router.push(`/campaigns/${campaignId}`);
    } catch (err) {
      setConfirmStart(false);
      toast.error(errorMessage(err));
    }
  }

  const sendable = stats.data?.audience.sendable ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button
              type="button"
              disabled={i >= step || busy}
              onClick={() => setStep(i as Step)}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
                i === step && "border-primary bg-primary/5 font-medium",
                i < step && "cursor-pointer hover:bg-muted",
                i > step && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-xs",
                  i <= step ? "bg-primary text-primary-foreground" : "bg-muted",
                )}
              >
                {i + 1}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <div>
        {step === 0 && <WizardStepBasics form={form} onChange={patch} listLocked={!isDraft} />}
        {step === 1 && <WizardStepInboxes form={form} onChange={patch} />}
        {step === 2 && campaignId && (
          <WizardStepEmail campaignId={campaignId} form={form} onChange={patch} />
        )}
        {step === 3 && (
          <WizardStepWindow form={form} onChange={patch} timezone={stats.data?.timezone ?? null} />
        )}
        {step === 4 && <WizardStepReview campaign={saved.data} form={form} />}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button variant="ghost" onClick={saveAndExit} disabled={busy}>
          <SaveIcon />
          {isDraft ? "Save draft & exit" : "Save & exit"}
        </Button>
        <div className="flex gap-2">
          {step > 0 && (
            <Button
              variant="outline"
              onClick={() => setStep((s) => (s - 1) as Step)}
              disabled={busy}
            >
              Back
            </Button>
          )}
          {step < 4 ? (
            <Button onClick={next} disabled={busy}>
              {busy ? "Saving…" : "Next"}
            </Button>
          ) : isDraft ? (
            <Button
              onClick={() => setConfirmStart(true)}
              disabled={busy || !stats.data || stats.data.usableInboxes === 0 || sendable === 0}
            >
              <PlayIcon />
              Start campaign
            </Button>
          ) : (
            <Button onClick={() => router.push(`/campaigns/${campaignId}`)} disabled={busy}>
              Done
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={confirmStart} onOpenChange={setConfirmStart}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start “{form.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {sendable.toLocaleString()} email{sendable === 1 ? "" : "s"} will be queued. The
              background worker sends them one by one inside the send window. You can pause the
              campaign at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button onClick={startNow} disabled={start.isPending}>
              {start.isPending ? "Starting…" : "Start"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
