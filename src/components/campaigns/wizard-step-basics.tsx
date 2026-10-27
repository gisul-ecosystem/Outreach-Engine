"use client";

import Link from "next/link";
import { SimpleSelect } from "@/components/common/simple-select";
import { useLists } from "@/components/contacts/use-contacts";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  DEFAULT_BODY_TEMPLATE,
  RACKO_DEFAULT_BODY,
  RACKO_DEFAULT_HTML,
  RACKO_DEFAULT_SUBJECT,
} from "@/shared/campaign";
import { useCampaigns } from "./use-campaigns";
import type { WizardForm } from "./wizard-form";

const FIRST = "first";
const FOLLOW_UP = "follow-up";

/** Step 1: campaign name, and either the contact list or the campaign this one follows up. */
export function WizardStepBasics({
  form,
  onChange,
  listLocked,
  typeLocked,
}: {
  form: WizardForm;
  onChange: (patch: Partial<WizardForm>) => void;
  /** The list cannot change once the campaign has started. */
  listLocked: boolean;
  /** First email / follow-up is chosen when the campaign is created. */
  typeLocked: boolean;
}) {
  const lists = useLists();
  const campaigns = useCampaigns({ page: 1, limit: 100 });
  const options = (lists.data?.data ?? []).map((l) => ({
    value: l.id,
    label: `${l.name} (${l.contactCount.toLocaleString()} contacts)`,
  }));
  // Only a first-email campaign can get a follow-up (one follow-up per campaign).
  const parents = (campaigns.data?.data ?? []).filter((c) => !c.followUpOf);
  const isFollowUp = form.followUpOf !== null;

  return (
    <div className="grid max-w-xl gap-5">
      <Field>
        <FieldLabel htmlFor="campaign-name">Campaign name</FieldLabel>
        <Input
          id="campaign-name"
          value={form.name}
          maxLength={200}
          onChange={(e) => onChange({ name: e.target.value })}
          autoFocus
        />
        <FieldDescription>Only you see this name. It is not part of the email.</FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="campaign-type">Type</FieldLabel>
        <SimpleSelect
          id="campaign-type"
          value={isFollowUp ? FOLLOW_UP : FIRST}
          onChange={(value) =>
            onChange(value === FOLLOW_UP ? { followUpOf: "", listId: null } : { followUpOf: null })
          }
          options={[
            { value: FIRST, label: "First email to a contact list" },
            { value: FOLLOW_UP, label: "Follow-up of an earlier campaign" },
          ]}
          disabled={typeLocked}
        />
        <FieldDescription>
          A follow-up only goes to people who got the first email and did not reply, from the same
          inbox, in the same conversation. One follow-up per campaign.
        </FieldDescription>
      </Field>

      {isFollowUp ? (
        <>
          <Field>
            <FieldLabel htmlFor="campaign-parent">First campaign</FieldLabel>
            <SimpleSelect
              id="campaign-parent"
              value={form.followUpOf || null}
              onChange={(id) => {
                const parent = parents.find((c) => c.id === id);
                onChange({ followUpOf: id, listId: parent?.listId ?? null });
              }}
              options={parents.map((c) => ({ value: c.id, label: c.name }))}
              disabled={typeLocked}
              placeholder={campaigns.isPending ? "Loading campaigns…" : "Choose a campaign"}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-days">Send after (days)</FieldLabel>
            <Input
              id="campaign-days"
              type="number"
              min={1}
              max={30}
              className="w-28"
              value={form.followUpAfterDays}
              onChange={(e) => onChange({ followUpAfterDays: Number(e.target.value) || 1 })}
            />
            <FieldDescription>Days after the first email (3–4 is usual).</FieldDescription>
          </Field>
        </>
      ) : (
        <Field>
          <FieldLabel htmlFor="campaign-list">Contact list</FieldLabel>
          <SimpleSelect
            id="campaign-list"
            value={form.listId}
            onChange={(listId) => {
              const patch: Partial<WizardForm> = { listId };
              // When selecting a list on a fresh campaign, pre-populate the Racko template with placeholder links
              if (
                !form.subjectTemplate.trim() &&
                (!form.bodyTemplate.trim() || form.bodyTemplate === DEFAULT_BODY_TEMPLATE)
              ) {
                patch.subjectTemplate = RACKO_DEFAULT_SUBJECT;
                patch.bodyTemplate = RACKO_DEFAULT_BODY;
                patch.bodyHtml = RACKO_DEFAULT_HTML;
              }
              onChange(patch);
            }}
            options={options}
            disabled={listLocked}
            placeholder={
              lists.isPending ? "Loading lists…" : options.length ? "Choose a list" : "No lists yet"
            }
          />
          <FieldDescription>
            {listLocked ? (
              "The list cannot be changed after the campaign has started."
            ) : (
              <>
                Every contact in this list gets one email. Need a new list?{" "}
                <Link href="/contacts" className="underline underline-offset-4">
                  Import contacts
                </Link>
                .
              </>
            )}
          </FieldDescription>
        </Field>
      )}
    </div>
  );
}
