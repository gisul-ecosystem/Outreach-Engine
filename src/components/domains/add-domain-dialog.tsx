"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import { createDomainSchema, type CreateDomainInput } from "@/shared/domain";
import { useCreateDomain } from "./use-domains";

export function AddDomainDialog() {
  const [open, setOpen] = useState(false);
  const createDomain = useCreateDomain();
  const form = useForm<CreateDomainInput>({
    resolver: zodResolver(createDomainSchema),
    defaultValues: { name: "" },
  });

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) form.reset();
  }

  const onSubmit = form.handleSubmit((values) =>
    createDomain.mutate(values, {
      onSuccess: () => onOpenChange(false),
      onError: (err) => {
        // Duplicate / invalid name → show it under the field; anything else → toast.
        if (err instanceof ApiClientError && [400, 409].includes(err.status)) {
          form.setError("name", { message: err.message });
        } else {
          toast.error(errorMessage(err));
        }
      },
    }),
  );

  const error = form.formState.errors.name;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        Add domain
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add domain</DialogTitle>
            <DialogDescription>
              The domain must already be added and verified in Microsoft 365. We check its DNS right
              away.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="domain-name">Domain name</FieldLabel>
            <Input
              id="domain-name"
              placeholder="example.com"
              autoComplete="off"
              autoFocus
              aria-invalid={!!error}
              {...form.register("name")}
            />
            <FieldDescription>Without http:// or www — for example tryracko.in</FieldDescription>
            <FieldError errors={[error]} />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={createDomain.isPending}>
              {createDomain.isPending ? "Adding and checking DNS…" : "Add domain"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
