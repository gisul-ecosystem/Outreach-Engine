"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SimpleSelect } from "@/components/common/simple-select";
import { useProviders } from "@/components/providers/use-providers";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/client/api";
import { createInboxSchema, type InboxDTO } from "@/shared/inbox";
import { InboxLimitFields } from "./inbox-limit-fields";
import { useUpdateInbox } from "./use-inboxes";

const formSchema = z
  .object({
    displayName: z.string().trim().max(100),
    providerConnectionId: createInboxSchema.shape.providerConnectionId,
    dailyLimit: createInboxSchema.shape.dailyLimit.unwrap(),
    minGapSeconds: createInboxSchema.shape.minGapSeconds.unwrap(),
    maxGapSeconds: createInboxSchema.shape.maxGapSeconds.unwrap(),
  })
  .refine((v) => v.minGapSeconds <= v.maxGapSeconds, {
    message: "Minimum gap must be less than or equal to the maximum gap",
    path: ["maxGapSeconds"],
  });

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

/** Edit display name, provider and sending limits. The email and domain cannot change. */
export function EditInboxDialog({
  inbox,
  onClose,
}: {
  inbox: InboxDTO | null;
  onClose: () => void;
}) {
  const providers = useProviders();
  const update = useUpdateInbox();
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    values: inbox
      ? {
          displayName: inbox.displayName,
          providerConnectionId: inbox.providerConnectionId ?? "",
          dailyLimit: inbox.dailyLimit,
          minGapSeconds: inbox.minGapSeconds,
          maxGapSeconds: inbox.maxGapSeconds,
        }
      : undefined,
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    if (!inbox) return;
    try {
      await update.mutateAsync({ id: inbox.id, ...values });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <Dialog open={!!inbox} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <FormProvider {...form}>
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Edit {inbox?.email}</DialogTitle>
              <DialogDescription>The email address and domain cannot be changed.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="edit-inbox-name">Display name</FieldLabel>
                <Input id="edit-inbox-name" {...form.register("displayName")} />
              </Field>
              <Field data-invalid={!!errors.providerConnectionId}>
                <FieldLabel htmlFor="edit-inbox-provider">Send through</FieldLabel>
                <Controller
                  control={form.control}
                  name="providerConnectionId"
                  render={({ field }) => (
                    <SimpleSelect
                      id="edit-inbox-provider"
                      value={field.value || null}
                      onChange={field.onChange}
                      options={(providers.data?.data ?? []).map((p) => ({
                        value: p.id,
                        label: p.name,
                      }))}
                      invalid={!!errors.providerConnectionId}
                    />
                  )}
                />
                <FieldError errors={[errors.providerConnectionId]} />
              </Field>
              <InboxLimitFields />
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
