"use client";

import Link from "next/link";
import { SimpleSelect } from "@/components/common/simple-select";
import { useLists } from "@/components/contacts/use-contacts";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { WizardForm } from "./wizard-form";

/** Step 1: campaign name and the contact list it goes to. */
export function WizardStepBasics({
  form,
  onChange,
  listLocked,
}: {
  form: WizardForm;
  onChange: (patch: Partial<WizardForm>) => void;
  /** The list cannot change once the campaign has started. */
  listLocked: boolean;
}) {
  const lists = useLists();
  const options = (lists.data?.data ?? []).map((l) => ({
    value: l.id,
    label: `${l.name} (${l.contactCount.toLocaleString()} contacts)`,
  }));

  return (
    <div className="grid max-w-xl gap-5">
      <Field>
        <FieldLabel htmlFor="campaign-name">Campaign name</FieldLabel>
        <Input
          id="campaign-name"
          placeholder="e.g. Racko – SaaS founders – Oct 2026"
          value={form.name}
          maxLength={200}
          onChange={(e) => onChange({ name: e.target.value })}
          autoFocus
        />
        <FieldDescription>Only you see this name. It is not part of the email.</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="campaign-list">Contact list</FieldLabel>
        <SimpleSelect
          id="campaign-list"
          value={form.listId}
          onChange={(listId) => onChange({ listId })}
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
    </div>
  );
}
