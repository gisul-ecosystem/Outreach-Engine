"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/client/api";
import {
  createProviderSchema,
  editProviderFormSchema,
  type CreateProviderInput,
  type ProviderDTO,
} from "@/shared/provider";
import { useCreateProvider, useUpdateProvider, useVerifyProvider } from "./use-providers";

type FormValues = CreateProviderInput;

/** Add a Microsoft 365 connection, or edit one (`provider` set). The secret is never shown again. */
export function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: ProviderDTO | null;
}) {
  const editing = !!provider;
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const verify = useVerifyProvider();

  const form = useForm<FormValues>({
    // Editing: the secret may be left empty to keep the saved one.
    resolver: zodResolver(editing ? editProviderFormSchema : createProviderSchema),
    values: {
      name: provider?.name ?? "Microsoft 365",
      type: "microsoft",
      tenantId: provider?.tenantId ?? "",
      clientId: provider?.clientId ?? "",
      clientSecret: "",
    },
  });
  const { errors } = form.formState;
  const pending = create.isPending || update.isPending;

  const close = () => {
    onOpenChange(false);
    form.reset();
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = editing
        ? await update.mutateAsync({
            id: provider.id,
            name: values.name,
            tenantId: values.tenantId,
            clientId: values.clientId,
            clientSecret: values.clientSecret || undefined,
          })
        : await create.mutateAsync(values);
      toast.success(`${saved.name} saved. Verifying with Microsoft…`);
      close();
      verify.mutate(saved);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Edit connection" : "Add Microsoft 365 connection"}
            </DialogTitle>
            <DialogDescription>
              The client secret is stored encrypted and is never shown again.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="provider-name">Name</FieldLabel>
              <Input id="provider-name" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field data-invalid={!!errors.tenantId}>
              <FieldLabel htmlFor="tenant-id">Directory (tenant) ID</FieldLabel>
              <Input
                id="tenant-id"
                autoComplete="off"
                placeholder="00000000-0000-0000-0000-000000000000"
                aria-invalid={!!errors.tenantId}
                {...form.register("tenantId")}
              />
              <FieldError errors={[errors.tenantId]} />
            </Field>
            <Field data-invalid={!!errors.clientId}>
              <FieldLabel htmlFor="client-id">Application (client) ID</FieldLabel>
              <Input
                id="client-id"
                autoComplete="off"
                placeholder="00000000-0000-0000-0000-000000000000"
                aria-invalid={!!errors.clientId}
                {...form.register("clientId")}
              />
              <FieldError errors={[errors.clientId]} />
            </Field>
            <Field data-invalid={!!errors.clientSecret}>
              <FieldLabel htmlFor="client-secret">Client secret value</FieldLabel>
              <Input
                id="client-secret"
                type="password"
                autoComplete="new-password"
                placeholder={editing ? "Leave empty to keep the saved secret" : ""}
                aria-invalid={!!errors.clientSecret}
                {...form.register("clientSecret")}
              />
              <FieldDescription>
                The secret <strong>Value</strong>, not the Secret ID.
              </FieldDescription>
              <FieldError errors={[errors.clientSecret]} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : editing ? "Save" : "Add connection"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
