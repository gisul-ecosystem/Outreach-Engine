"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Controller, FormProvider, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { SimpleSelect } from "@/components/common/simple-select";
import { useDomains } from "@/components/domains/use-domains";
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
import { ApiClientError, errorMessage } from "@/lib/client/api";
import { objectIdSchema } from "@/shared/common";
import { DEFAULTS } from "@/shared/enums";
import { createInboxSchema } from "@/shared/inbox";
import { InboxLimitFields } from "./inbox-limit-fields";
import { useCreateInbox } from "./use-inboxes";

// The form asks for the part before "@" and a domain; the full email is built from both,
// so the email always matches its domain.
const formSchema = z
  .object({
    domainId: objectIdSchema.or(z.literal("")).refine((v) => v !== "", "Choose a domain"),
    providerConnectionId: objectIdSchema
      .or(z.literal(""))
      .refine((v) => v !== "", "Choose a provider connection"),
    localPart: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Enter the part before @")
      .regex(/^[a-z0-9._%+-]+$/, "Only letters, numbers and . _ % + - are allowed"),
    displayName: z.string().trim().max(100),
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

export function AddInboxDialog({
  defaultDomainId,
  open: controlledOpen,
  onClose,
  hideTrigger = false,
}: {
  defaultDomainId?: string;
  /** Pass these three to open the dialog from another component (no button of its own). */
  open?: boolean;
  onClose?: () => void;
  hideTrigger?: boolean;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    if (!next) onClose?.();
  };
  const domains = useDomains({ page: 1, limit: 100 });
  const providers = useProviders();
  const createInbox = useCreateInbox();

  const providerOptions = (providers.data?.data ?? []).map((p) => ({
    value: p.id,
    label: p.status === "connected" ? p.name : `${p.name} (not verified)`,
  }));
  const domainList = domains.data?.data ?? [];

  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      domainId: defaultDomainId ?? "",
      providerConnectionId: "",
      localPart: "",
      displayName: "",
      dailyLimit: DEFAULTS.dailyLimit,
      minGapSeconds: DEFAULTS.minGapSeconds,
      maxGapSeconds: DEFAULTS.maxGapSeconds,
    },
  });
  const { errors } = form.formState;
  const selectedDomainId = useWatch({ control: form.control, name: "domainId" });
  const domainName = domainList.find((d) => d.id === selectedDomainId)?.name;

  // When opened from outside, pre-select the domain and the only provider.
  useEffect(() => {
    if (!controlledOpen) return;
    if (defaultDomainId && !form.getValues("domainId")) form.setValue("domainId", defaultDomainId);
    if (!form.getValues("providerConnectionId") && providerOptions.length === 1) {
      form.setValue("providerConnectionId", providerOptions[0].value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledOpen, defaultDomainId, providerOptions.length]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      // Pre-select when there is only one choice.
      if (!form.getValues("domainId") && domainList.length === 1) {
        form.setValue("domainId", domainList[0].id);
      }
      if (!form.getValues("providerConnectionId") && providerOptions.length === 1) {
        form.setValue("providerConnectionId", providerOptions[0].value);
      }
    } else {
      form.reset();
    }
  }

  const onSubmit = form.handleSubmit(async (values) => {
    const domain = domainList.find((d) => d.id === values.domainId);
    try {
      await createInbox.mutateAsync({
        domainId: values.domainId,
        providerConnectionId: values.providerConnectionId,
        email: `${values.localPart}@${domain?.name ?? ""}`,
        displayName: values.displayName,
        dailyLimit: values.dailyLimit,
        minGapSeconds: values.minGapSeconds,
        maxGapSeconds: values.maxGapSeconds,
      });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiClientError && [400, 409].includes(err.status)) {
        form.setError("localPart", { message: err.message.replace(/^email: /, "") });
      } else {
        toast.error(errorMessage(err));
      }
    }
  });

  const missingSetup = domainList.length === 0 || providerOptions.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {!hideTrigger && (
        <Button onClick={() => onOpenChange(true)}>
          <PlusIcon />
          Add inbox
        </Button>
      )}
      <DialogContent className="sm:max-w-lg">
        {missingSetup && !domains.isPending && !providers.isPending ? (
          <>
            <DialogHeader>
              <DialogTitle>Add inbox</DialogTitle>
              <DialogDescription>Before adding an inbox you need:</DialogDescription>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {domainList.length === 0 && (
                <li>
                  a domain —{" "}
                  <Link className="underline" href="/domains">
                    add one on the Domains page
                  </Link>
                </li>
              )}
              {providerOptions.length === 0 && (
                <li>
                  a Microsoft 365 connection —{" "}
                  <Link className="underline" href="/providers">
                    add one on the Providers page
                  </Link>
                </li>
              )}
            </ul>
          </>
        ) : (
          <FormProvider {...form}>
            <form onSubmit={onSubmit} noValidate className="grid gap-4">
              <DialogHeader>
                <DialogTitle>Add inbox</DialogTitle>
                <DialogDescription>
                  The mailbox must already exist in Microsoft 365.
                </DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field data-invalid={!!errors.domainId}>
                  <FieldLabel htmlFor="inbox-domain">Domain</FieldLabel>
                  <Controller
                    control={form.control}
                    name="domainId"
                    render={({ field }) => (
                      <SimpleSelect
                        id="inbox-domain"
                        value={field.value || null}
                        onChange={field.onChange}
                        options={domainList.map((d) => ({ value: d.id, label: d.name }))}
                        placeholder="Choose a domain"
                        invalid={!!errors.domainId}
                      />
                    )}
                  />
                  <FieldError errors={[errors.domainId]} />
                </Field>
                <Field data-invalid={!!errors.localPart}>
                  <FieldLabel htmlFor="inbox-local">Email address</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="inbox-local"
                      placeholder="sales"
                      autoComplete="off"
                      aria-invalid={!!errors.localPart}
                      {...form.register("localPart")}
                    />
                    <span className="shrink-0 text-sm text-muted-foreground">
                      @{domainName ?? "domain"}
                    </span>
                  </div>
                  <FieldError errors={[errors.localPart]} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="inbox-name">Display name (shown as the sender)</FieldLabel>
                  <Input
                    id="inbox-name"
                    placeholder="Priya from Racko"
                    {...form.register("displayName")}
                  />
                </Field>
                <Field data-invalid={!!errors.providerConnectionId}>
                  <FieldLabel htmlFor="inbox-provider">Send through</FieldLabel>
                  <Controller
                    control={form.control}
                    name="providerConnectionId"
                    render={({ field }) => (
                      <SimpleSelect
                        id="inbox-provider"
                        value={field.value || null}
                        onChange={field.onChange}
                        options={providerOptions}
                        placeholder="Choose a provider connection"
                        invalid={!!errors.providerConnectionId}
                      />
                    )}
                  />
                  <FieldError errors={[errors.providerConnectionId]} />
                </Field>
                <InboxLimitFields />
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createInbox.isPending}>
                  {createInbox.isPending ? "Adding…" : "Add inbox"}
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        )}
      </DialogContent>
    </Dialog>
  );
}
