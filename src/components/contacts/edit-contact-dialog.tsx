"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SimpleSelect } from "@/components/common/simple-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/client/api";
import type { ContactDTO } from "@/shared/contact";
import { CONTACT_STATUSES } from "@/shared/enums";
import { useUpdateContact } from "./use-contacts";

const formSchema = z.object({
  firstName: z.string().trim().max(100),
  lastName: z.string().trim().max(100),
  company: z.string().trim().max(200),
  title: z.string().trim().max(200),
  status: z.enum(CONTACT_STATUSES),
});
type FormValues = z.infer<typeof formSchema>;

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "unsubscribed", label: "Unsubscribed" },
  { value: "bounced", label: "Bounced" },
];

export function EditContactDialog({
  contact,
  onClose,
}: {
  contact: ContactDTO | null;
  onClose: () => void;
}) {
  const update = useUpdateContact();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    values: contact
      ? {
          firstName: contact.firstName,
          lastName: contact.lastName,
          company: contact.company,
          title: contact.title,
          status: contact.status,
        }
      : undefined,
  });

  const onSubmit = form.handleSubmit(async (values) => {
    if (!contact) return;
    try {
      await update.mutateAsync({ id: contact.id, ...values });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  const custom = Object.entries(contact?.custom ?? {});

  return (
    <Dialog open={!!contact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit contact</DialogTitle>
            <DialogDescription>{contact?.email}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="c-first">First name</FieldLabel>
                <Input id="c-first" {...form.register("firstName")} />
              </Field>
              <Field>
                <FieldLabel htmlFor="c-last">Last name</FieldLabel>
                <Input id="c-last" {...form.register("lastName")} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="c-company">Company</FieldLabel>
              <Input id="c-company" {...form.register("company")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-title">Job title</FieldLabel>
              <Input id="c-title" {...form.register("title")} />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-status">Status</FieldLabel>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <SimpleSelect
                    id="c-status"
                    value={field.value}
                    onChange={field.onChange}
                    options={STATUS_OPTIONS}
                  />
                )}
              />
              {contact?.suppressed && (
                <FieldDescription>
                  This email is on the suppression list, so it can&apos;t be made active.
                </FieldDescription>
              )}
            </Field>
            {custom.length > 0 && (
              <div className="grid gap-1 text-sm">
                <span className="font-medium">Custom fields</span>
                {custom.map(([key, value]) => (
                  <span key={key} className="text-muted-foreground">
                    <code>{`{{custom.${key}}}`}</code> = {value}
                  </span>
                ))}
              </div>
            )}
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
      </DialogContent>
    </Dialog>
  );
}
