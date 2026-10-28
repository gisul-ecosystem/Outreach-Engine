"use client";

import { Controller, useFormContext, useWatch } from "react-hook-form";
import { SimpleSelect } from "@/components/common/simple-select";
import { useProviders } from "@/components/providers/use-providers";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";

/** Select value for "no separate reader" (the form itself holds null). */
const SAME_AS_SENDER = "same";

type Values = { providerConnectionId: string; readingConnectionId: string | null };

/**
 * "Read replies with": an optional Microsoft 365 connection that reads the mailbox for replies and
 * bounces, for inboxes that send through ZeptoMail (which cannot read a mailbox).
 */
export function ReadingConnectionField({ id }: { id: string }) {
  const providers = useProviders();
  const form = useFormContext<Values>();
  const sendingId = useWatch<Values>({ name: "providerConnectionId" });
  const all = providers.data?.data ?? [];
  const sendsWithZepto = all.find((p) => p.id === sendingId)?.type === "zeptomail";
  const error = form.formState.errors.readingConnectionId;

  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>Read replies with</FieldLabel>
      <Controller
        control={form.control}
        name="readingConnectionId"
        render={({ field }) => (
          <SimpleSelect
            id={id}
            value={field.value ?? SAME_AS_SENDER}
            onChange={(v) => field.onChange(v === SAME_AS_SENDER ? null : v)}
            options={[
              { value: SAME_AS_SENDER, label: "Same as “Send through”" },
              ...all
                .filter((p) => p.type === "microsoft")
                .map((p) => ({
                  value: p.id,
                  label: `${p.name} (Microsoft 365)${p.status === "connected" ? "" : " — not verified"}`,
                })),
            ]}
            invalid={!!error}
          />
        )}
      />
      <FieldDescription>
        {sendsWithZepto
          ? "ZeptoMail cannot read a mailbox. Choose the Microsoft 365 connection whose Outlook mailbox receives the replies (needs Mail.Read)."
          : "Which connection reads this mailbox for replies and bounces."}
      </FieldDescription>
      <FieldError errors={[error]} />
    </Field>
  );
}
