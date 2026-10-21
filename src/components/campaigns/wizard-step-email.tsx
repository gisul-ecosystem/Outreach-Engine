"use client";

import { AlertTriangleIcon, PlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { SimpleSelect } from "@/components/common/simple-select";
import { useContacts } from "@/components/contacts/use-contacts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/client/api";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  OPT_OUT_LINE,
  STANDARD_VARIABLES,
} from "@/shared/campaign";
import { useCampaignPreview } from "./use-campaigns";
import type { WizardForm } from "./wizard-form";

const AUTO = "auto";
const LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  company: "Company",
  title: "Job title",
  email: "Email",
};

/** Step 3: subject + body with clickable variable chips and a live preview for a real contact. */
export function WizardStepEmail({
  campaignId,
  form,
  onChange,
}: {
  campaignId: string;
  form: WizardForm;
  onChange: (patch: Partial<WizardForm>) => void;
}) {
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<"subjectTemplate" | "bodyTemplate">("bodyTemplate");
  const [contactId, setContactId] = useState(AUTO);

  const contacts = useContacts({ page: 1, limit: 50, listId: form.listId ?? undefined });
  const previewInput = useDebouncedValue(
    {
      contactId: contactId === AUTO ? undefined : contactId,
      subjectTemplate: form.subjectTemplate,
      bodyTemplate: form.bodyTemplate,
    },
    400,
  );
  const preview = useCampaignPreview(campaignId, previewInput);

  const customVariables = preview.data?.customVariables ?? [];
  const variables = [...STANDARD_VARIABLES, ...customVariables];

  /** Inserts {{name}} where the cursor is in the subject or body (whichever was used last). */
  function insert(name: string) {
    const field = lastField.current;
    const el = field === "subjectTemplate" ? subjectRef.current : bodyRef.current;
    const value = form[field];
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange({ [field]: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const contactOptions = [
    { value: AUTO, label: "First contact in the list" },
    ...(contacts.data?.data ?? []).map((c) => ({
      value: c.id,
      label: [c.firstName, c.lastName].filter(Boolean).join(" ")
        ? `${[c.firstName, c.lastName].filter(Boolean).join(" ")} <${c.email}>`
        : c.email,
    })),
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid content-start gap-5">
        <Field>
          <FieldLabel htmlFor="subject">Subject</FieldLabel>
          <Input
            id="subject"
            ref={subjectRef}
            placeholder="e.g. Quick question, {{firstName|there}}"
            value={form.subjectTemplate}
            maxLength={MAX_SUBJECT_LENGTH}
            onFocus={() => (lastField.current = "subjectTemplate")}
            onChange={(e) => onChange({ subjectTemplate: e.target.value })}
          />
        </Field>

        <div className="grid gap-2">
          <span className="text-sm font-medium">Insert a variable</span>
          <div className="flex flex-wrap gap-1.5">
            {variables.map((name) => (
              <Button
                key={name}
                type="button"
                variant="outline"
                size="xs"
                onMouseDown={(e) => e.preventDefault()} // keep the cursor in the text field
                onClick={() => insert(name)}
              >
                {LABELS[name] ?? name}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Click to insert at the cursor. Add a fallback for empty values with <code>|</code>, e.g.{" "}
            <code>{"{{firstName|there}}"}</code> → “Hi there” when the first name is missing.
          </p>
        </div>

        <Field>
          <FieldLabel htmlFor="body">Email (plain text)</FieldLabel>
          <Textarea
            id="body"
            ref={bodyRef}
            rows={14}
            value={form.bodyTemplate}
            maxLength={MAX_BODY_LENGTH}
            onFocus={() => (lastField.current = "bodyTemplate")}
            onChange={(e) => onChange({ bodyTemplate: e.target.value })}
            className="font-mono text-sm"
          />
          <FieldDescription>
            Plain text, no tracking, few or no links — this lands in the inbox more often.
          </FieldDescription>
        </Field>
        {!form.bodyTemplate.includes(OPT_OUT_LINE) && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span>Every email should end with a simple opt-out line.</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({ bodyTemplate: `${form.bodyTemplate.trimEnd()}\n\n${OPT_OUT_LINE}` })
              }
            >
              <PlusIcon />
              Add opt-out line
            </Button>
          </div>
        )}
      </div>

      <div className="grid content-start gap-3">
        <Field>
          <FieldLabel>Preview as</FieldLabel>
          <SimpleSelect value={contactId} onChange={setContactId} options={contactOptions} />
        </Field>
        <div className="rounded-lg border">
          {preview.isError ? (
            <p className="p-4 text-sm text-destructive">{errorMessage(preview.error)}</p>
          ) : !preview.data ? (
            <div className="grid gap-2 p-4">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <div className="grid gap-1 border-b p-4 text-sm">
                <div>
                  <span className="text-muted-foreground">To: </span>
                  {preview.data.contact?.email ?? "(no contact)"}
                </div>
                <div>
                  <span className="text-muted-foreground">Subject: </span>
                  <span className="font-medium">{preview.data.subject || "(empty)"}</span>
                </div>
              </div>
              <div className="p-4 text-sm whitespace-pre-wrap">
                {preview.data.text || <span className="text-muted-foreground">(empty)</span>}
              </div>
            </>
          )}
        </div>
        {preview.data && preview.data.warnings.length > 0 && (
          <div className="grid gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <span className="flex items-center gap-1.5 font-medium">
              <AlertTriangleIcon className="size-4" />
              Check before sending
            </span>
            <ul className="list-disc pl-5">
              {preview.data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {preview.data && preview.data.warnings.length === 0 && (
          <Badge variant="outline" className="w-fit">
            No problems found for this contact
          </Badge>
        )}
      </div>
    </div>
  );
}
