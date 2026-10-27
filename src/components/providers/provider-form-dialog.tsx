"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/client/api";
import {
  DEFAULT_SEND_FORMAT,
  DEFAULT_ZEPTO_REGION,
  SEND_FORMATS,
  ZEPTO_REGIONS,
  type SendFormat,
  type ZeptoRegion,
} from "@/shared/enums";
import {
  createProviderSchema,
  createZeptoProviderSchema,
  editProviderFormSchema,
  editZeptoProviderFormSchema,
  PROVIDER_TYPE_LABELS,
  SEND_FORMAT_LABELS,
  ZEPTO_REGION_LABELS,
  type CreateProviderInput,
  type CreateZeptoProviderInput,
  type ProviderDTO,
} from "@/shared/provider";
import { useCreateProvider, useUpdateProvider, useVerifyProvider } from "./use-providers";

type ConnectionType = "microsoft" | "zeptomail";
const TYPE_OPTIONS = (["microsoft", "zeptomail"] as const).map((t) => ({
  value: t,
  label: PROVIDER_TYPE_LABELS[t],
}));

/**
 * Add a connection (Microsoft 365 or ZeptoMail), or edit one (`provider` set — its type cannot change).
 * The secret / token is never shown again.
 */
export function ProviderFormDialog({
  open,
  onOpenChange,
  provider,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider?: ProviderDTO | null;
}) {
  const [chosenType, setChosenType] = useState<ConnectionType>("microsoft");
  const type: ConnectionType =
    provider?.type === "zeptomail" ? "zeptomail" : provider ? "microsoft" : chosenType;

  const close = () => {
    onOpenChange(false);
    setChosenType("microsoft");
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        {type === "zeptomail" ? (
          <ZeptoForm
            provider={provider}
            onClose={close}
            typePicker={!provider && <TypePicker value={type} onChange={setChosenType} />}
          />
        ) : (
          <MicrosoftForm
            provider={provider}
            onClose={close}
            typePicker={!provider && <TypePicker value={type} onChange={setChosenType} />}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TypePicker({
  value,
  onChange,
}: {
  value: ConnectionType;
  onChange: (type: ConnectionType) => void;
}) {
  return (
    <Field>
      <FieldLabel>Type</FieldLabel>
      <SimpleSelect
        value={value}
        onChange={(v) => onChange(v as ConnectionType)}
        options={TYPE_OPTIONS}
      />
      <FieldDescription>
        Each inbox chooses which connection it sends through (Inboxes → Edit → Send through).
      </FieldDescription>
    </Field>
  );
}

type FormProps = { provider?: ProviderDTO | null; onClose: () => void; typePicker: ReactNode };

function MicrosoftForm({ provider, onClose, typePicker }: FormProps) {
  const editing = !!provider;
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const verify = useVerifyProvider();

  const form = useForm<CreateProviderInput>({
    // Editing: the secret may be left empty to keep the saved one.
    resolver: zodResolver(editing ? editProviderFormSchema : createProviderSchema),
    values: {
      name: provider?.name ?? "Microsoft 365",
      type: "microsoft",
      tenantId: provider?.tenantId ?? "",
      clientId: provider?.clientId ?? "",
      clientSecret: "",
      sendFormat: provider?.sendFormat ?? DEFAULT_SEND_FORMAT,
    },
  });
  const { errors } = form.formState;
  const pending = create.isPending || update.isPending;
  const sendFormat = (useWatch({ control: form.control, name: "sendFormat" }) ??
    DEFAULT_SEND_FORMAT) as SendFormat;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = editing
        ? await update.mutateAsync({
            id: provider.id,
            name: values.name,
            tenantId: values.tenantId,
            clientId: values.clientId,
            clientSecret: values.clientSecret || undefined,
            sendFormat: values.sendFormat,
          })
        : await create.mutateAsync(values);
      toast.success(`${saved.name} saved. Verifying with Microsoft…`);
      onClose();
      form.reset();
      verify.mutate(saved);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit connection" : "Add connection"}</DialogTitle>
        <DialogDescription>
          The client secret is stored encrypted and is never shown again.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {typePicker}
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
        <Field>
          <FieldLabel>Sending format</FieldLabel>
          <SimpleSelect
            value={sendFormat}
            onChange={(value) =>
              form.setValue("sendFormat", value as SendFormat, { shouldDirty: true })
            }
            options={SEND_FORMATS.map((f) => ({
              value: f,
              label: SEND_FORMAT_LABELS[f].label,
            }))}
          />
          <FieldDescription>{SEND_FORMAT_LABELS[sendFormat].description}</FieldDescription>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Add connection"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function ZeptoForm({ provider, onClose, typePicker }: FormProps) {
  const editing = !!provider;
  const create = useCreateProvider();
  const update = useUpdateProvider();
  const verify = useVerifyProvider();

  const form = useForm<CreateZeptoProviderInput>({
    // Editing: the token may be left empty to keep the saved one.
    resolver: zodResolver(editing ? editZeptoProviderFormSchema : createZeptoProviderSchema),
    values: {
      name: provider?.name ?? "ZeptoMail",
      type: "zeptomail",
      region: provider?.region ?? DEFAULT_ZEPTO_REGION,
      apiToken: "",
    },
  });
  const { errors } = form.formState;
  const pending = create.isPending || update.isPending;
  const region = (useWatch({ control: form.control, name: "region" }) ??
    DEFAULT_ZEPTO_REGION) as ZeptoRegion;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = editing
        ? await update.mutateAsync({
            id: provider.id,
            name: values.name,
            region: values.region,
            apiToken: values.apiToken || undefined,
          })
        : await create.mutateAsync(values);
      toast.success(`${saved.name} saved. Checking the token with ZeptoMail…`);
      onClose();
      form.reset();
      verify.mutate(saved);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit ZeptoMail connection" : "Add connection"}</DialogTitle>
        <DialogDescription>
          The Send Mail token is stored encrypted and is never shown again.
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {typePicker}
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="zepto-name">Name</FieldLabel>
          <Input id="zepto-name" aria-invalid={!!errors.name} {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>
        <Field data-invalid={!!errors.region}>
          <FieldLabel>Region</FieldLabel>
          <SimpleSelect
            value={region}
            onChange={(value) =>
              form.setValue("region", value as ZeptoRegion, { shouldDirty: true })
            }
            options={ZEPTO_REGIONS.map((r) => ({ value: r, label: ZEPTO_REGION_LABELS[r] }))}
          />
          <FieldDescription>
            The site you sign in to ZeptoMail on. A token only works in its own region.
          </FieldDescription>
          <FieldError errors={[errors.region]} />
        </Field>
        <Field data-invalid={!!errors.apiToken}>
          <FieldLabel htmlFor="zepto-token">Send Mail token</FieldLabel>
          <Input
            id="zepto-token"
            type="password"
            autoComplete="new-password"
            placeholder={editing ? "Leave empty to keep the saved token" : "Zoho-enczapikey …"}
            aria-invalid={!!errors.apiToken}
            {...form.register("apiToken")}
          />
          <FieldDescription>
            ZeptoMail → Mail Agents → your agent → <strong>SMTP/API</strong> → API → Send Mail
            token. Pasting it with or without “Zoho-enczapikey” both work.
          </FieldDescription>
          <FieldError errors={[errors.apiToken]} />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : editing ? "Save" : "Add connection"}
        </Button>
      </DialogFooter>
    </form>
  );
}
