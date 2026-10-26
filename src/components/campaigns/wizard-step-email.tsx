"use client";

import { AlertTriangleIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
import { cn } from "@/lib/utils";
import {
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  OPT_OUT_LINE,
  SENDER_VARIABLES,
  STANDARD_VARIABLES,
} from "@/shared/campaign";
import { applyFix, type ReadinessFix, type ReadinessItem } from "@/shared/readiness";
import { CampaignTestSendDialog } from "./campaign-test-send-dialog";
import { ReadinessPanel } from "./readiness-panel";
import { useCampaignPreview } from "./use-campaigns";
import { useLiveReadiness } from "./use-readiness";
import { formTemplates, parseWords, type WizardForm, type WizardVariant } from "./wizard-form";

type EditorField = "subjectTemplate" | "bodyTemplate" | "bodyHtml";

const AUTO = "auto";
const MAX_VERSIONS = 6; // main + 5 variants (API limit)
const LABELS: Record<string, string> = {
  firstName: "First name",
  lastName: "Last name",
  company: "Company",
  title: "Job title",
  email: "Email",
  senderName: "Your name",
  senderRole: "Your role",
  senderEmail: "Your email",
  originalSubject: "First email's subject (follow-ups)",
};

/**
 * Step 3: subject + body with clickable variable chips and a live preview for a real contact.
 * Optional: an own HTML version, and extra versions picked by a contact column (template rotation).
 */
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
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const lastField = useRef<EditorField>("bodyTemplate");
  const [contactId, setContactId] = useState(AUTO);
  /** 0 = the main template, n = form.variants[n - 1] */
  const [active, setActive] = useState(0);
  const [testOpen, setTestOpen] = useState(false);
  const isFollowUp = form.followUpOf !== null;
  const live = useLiveReadiness(campaignId, formTemplates(form), isFollowUp);

  const versions: WizardVariant[] = [
    {
      name: form.templateName,
      subjectTemplate: form.subjectTemplate,
      bodyTemplate: form.bodyTemplate,
      bodyHtml: form.bodyHtml,
      matchValues: form.matchValues,
    },
    ...form.variants,
  ];
  const current = versions[Math.min(active, versions.length - 1)];

  /** Changes one version (the main one lives in the campaign's own fields). */
  function updateVersion(index: number, p: Partial<WizardVariant>) {
    if (index === 0) {
      const { name, ...rest } = p;
      onChange({ ...rest, ...(name !== undefined ? { templateName: name } : {}) });
    } else {
      onChange({ variants: form.variants.map((v, i) => (i === index - 1 ? { ...v, ...p } : v)) });
    }
  }
  /** Changes the version being edited. */
  const setCurrent = (p: Partial<WizardVariant>) => updateVersion(active, p);

  /** Focuses the field and selects `text` in it, so the problem is easy to see. */
  function highlight(field: EditorField, text: string) {
    // After React has shown the new text (and maybe switched version).
    setTimeout(() => {
      const el = { subjectTemplate: subjectRef, bodyTemplate: bodyRef, bodyHtml: htmlRef }[field]
        .current;
      if (!el) return;
      const at = text ? el.value.indexOf(text) : -1;
      el.focus();
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      if (at >= 0) el.setSelectionRange(at, at + text.length);
    }, 50);
  }

  /** "Add it" / "Use …" / "Show me" from the readiness panel. */
  function fix(item: ReadinessItem, f: ReadinessFix) {
    if (f.kind !== "insert" && f.kind !== "replace" && f.kind !== "show") return;
    const index = Math.min(item.template ?? active, versions.length - 1);
    if (index !== active) setActive(index);
    const version = versions[index];
    if (f.kind === "show") return highlight(f.field, f.find);
    if (f.field === "bodyHtml" && version.bodyHtml === null) return;
    updateVersion(index, { [f.field]: applyFix(version[f.field] ?? "", f) });
    const added = f.kind === "insert" ? f.text : f.replace;
    highlight(f.field, added.trim().split("\n")[0] ?? "");
  }

  function addVersion() {
    onChange({
      variants: [
        ...form.variants,
        {
          name: "",
          subjectTemplate: "",
          bodyTemplate: `Hi {{firstName}},\n\n\n\n${OPT_OUT_LINE}`,
          bodyHtml: null,
          matchValues: [],
        },
      ],
    });
    setActive(form.variants.length + 1);
  }

  function removeVersion() {
    onChange({ variants: form.variants.filter((_, i) => i !== active - 1) });
    setActive(0);
  }

  const contacts = useContacts({ page: 1, limit: 50, listId: form.listId ?? undefined });
  const previewInput = useDebouncedValue(
    {
      contactId: contactId === AUTO ? undefined : contactId,
      subjectTemplate: current.subjectTemplate,
      bodyTemplate: current.bodyTemplate,
      bodyHtml: current.bodyHtml,
    },
    400,
  );
  const preview = useCampaignPreview(campaignId, previewInput);

  const customVariables = preview.data?.customVariables ?? [];
  const variables = [...STANDARD_VARIABLES, ...SENDER_VARIABLES, ...customVariables].filter(
    (v) => isFollowUp || v !== "originalSubject",
  );

  /** Inserts {{name}} where the cursor is in the subject, body or HTML (whichever was used last). */
  function insert(name: string) {
    const field = lastField.current;
    const el = { subjectTemplate: subjectRef, bodyTemplate: bodyRef, bodyHtml: htmlRef }[field]
      .current;
    const value = current[field] ?? "";
    const token = `{{${name}}}`;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    setCurrent({ [field]: value.slice(0, start) + token + value.slice(end) });
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
  // Columns that can pick a version: standard fields + the list's custom columns.
  const columnOptions = [
    { value: "", label: "None — versions take turns" },
    ...["title", "company", ...customVariables].map((c) => ({ value: c, label: c })),
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="grid content-start gap-5">
        {!isFollowUp && (
          <div className="grid gap-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-sm font-medium">Versions</span>
              {versions.map((v, i) => (
                <Button
                  key={i}
                  type="button"
                  size="xs"
                  variant={i === active ? "default" : "outline"}
                  onClick={() => setActive(i)}
                >
                  {v.name.trim() || (i === 0 ? "Main" : `Version ${i + 1}`)}
                </Button>
              ))}
              {versions.length < MAX_VERSIONS && (
                <Button type="button" size="xs" variant="ghost" onClick={addVersion}>
                  <PlusIcon />
                  Add version
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Optional: different emails for different kinds of contacts. Each contact gets the
              version whose words appear in the chosen column; everyone else gets them in turn.
            </p>
            {versions.length > 1 && (
              <Field>
                <FieldLabel>Pick the version by this contact column</FieldLabel>
                <SimpleSelect
                  value={form.variantColumn}
                  onChange={(variantColumn) => onChange({ variantColumn })}
                  options={columnOptions}
                />
              </Field>
            )}
          </div>
        )}

        <div className={cn("grid gap-4", versions.length > 1 && "sm:grid-cols-2")}>
          <Field>
            <FieldLabel htmlFor="template-name">Template name</FieldLabel>
            <Input
              id="template-name"
              value={current.name}
              maxLength={200}
              placeholder={active === 0 ? form.name : ""}
              onChange={(e) => setCurrent({ name: e.target.value })}
            />
            <FieldDescription>Shown in the logs. Empty = the campaign name.</FieldDescription>
          </Field>
          {versions.length > 1 && (
            <Field>
              <FieldLabel htmlFor="template-words">Words that pick this version</FieldLabel>
              <Input
                id="template-words"
                key={active} // fresh text when switching versions
                defaultValue={current.matchValues.join(", ")}
                placeholder="comma separated"
                onBlur={(e) => setCurrent({ matchValues: parseWords(e.target.value) })}
              />
            </Field>
          )}
        </div>

        <Field>
          <FieldLabel htmlFor="subject">Subject</FieldLabel>
          <Input
            id="subject"
            ref={subjectRef}
            value={current.subjectTemplate}
            maxLength={MAX_SUBJECT_LENGTH}
            onFocus={() => (lastField.current = "subjectTemplate")}
            onChange={(e) => setCurrent({ subjectTemplate: e.target.value })}
          />
          {isFollowUp && (
            <FieldDescription>
              Use <code>{"{{originalSubject}}"}</code>. In Outlook format the follow-up is a real
              reply, and Microsoft makes the subject “RE: &lt;first email’s subject&gt;” itself.
            </FieldDescription>
          )}
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
            <code>{"{{firstName|there}}"}</code>. Without a fallback, a contact missing that value
            is skipped (never sent “Hi ,”). “Your name / role” come from the inbox (Inboxes → Edit).
          </p>
        </div>

        <Field>
          <FieldLabel htmlFor="body">Email (plain text)</FieldLabel>
          <Textarea
            id="body"
            ref={bodyRef}
            rows={14}
            value={current.bodyTemplate}
            maxLength={MAX_BODY_LENGTH}
            onFocus={() => (lastField.current = "bodyTemplate")}
            onChange={(e) => setCurrent({ bodyTemplate: e.target.value })}
            className="font-mono text-sm"
          />
          <FieldDescription>
            No tracking, at most one link. The readiness checks on the right update as you type.
          </FieldDescription>
        </Field>

        <Field>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={current.bodyHtml !== null}
              onChange={(e) => setCurrent({ bodyHtml: e.target.checked ? "" : null })}
            />
            Write my own HTML version
          </label>
          {current.bodyHtml === null ? (
            <FieldDescription>
              Off: the text above is laid out like an email typed in Outlook (Microsoft adds the
              plain-text version itself).
            </FieldDescription>
          ) : (
            <Textarea
              ref={htmlRef}
              rows={10}
              value={current.bodyHtml}
              maxLength={MAX_BODY_LENGTH}
              placeholder='<div style="font-family: Calibri, Arial, sans-serif; font-size: 15px;">…</div>'
              onFocus={() => (lastField.current = "bodyHtml")}
              onChange={(e) => setCurrent({ bodyHtml: e.target.value })}
              className="font-mono text-sm"
            />
          )}
        </Field>

        {active > 0 && (
          <Button type="button" variant="outline" className="w-fit" onClick={removeVersion}>
            <Trash2Icon />
            Remove this version
          </Button>
        )}
      </div>

      <div className="grid content-start gap-3">
        <ReadinessPanel
          items={live.content}
          versionNames={versions.map(
            (v, i) => v.name.trim() || (i === 0 ? "Main" : `Version ${i + 1}`),
          )}
          loading={live.readiness.isPending}
          onFix={fix}
          onSendTest={() => setTestOpen(true)}
        />
        <CampaignTestSendDialog
          campaignId={campaignId}
          inboxes={live.readiness.data?.inboxes ?? []}
          open={testOpen}
          onOpenChange={setTestOpen}
        />
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
              {preview.data.html && (
                <iframe
                  title="HTML version"
                  sandbox=""
                  srcDoc={preview.data.html}
                  className="h-72 w-full border-t bg-white"
                />
              )}
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
