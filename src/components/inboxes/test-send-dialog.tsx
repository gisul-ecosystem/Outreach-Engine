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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/client/api";
import { testSendSchema, type InboxDTO, type TestSendInput } from "@/shared/inbox";
import { useTestSend } from "./use-inboxes";

/** Sends one short test email from the inbox (simulated while DRY_RUN=true). */
export function TestSendDialog({
  inbox,
  onClose,
}: {
  inbox: InboxDTO | null;
  onClose: () => void;
}) {
  const testSend = useTestSend();
  const form = useForm<TestSendInput>({
    resolver: zodResolver(testSendSchema),
    defaultValues: { to: "" },
  });
  const error = form.formState.errors.to;

  const close = () => {
    onClose();
    form.reset();
  };

  const onSubmit = form.handleSubmit((values) => {
    if (!inbox) return;
    testSend.mutate(
      { inbox, to: values.to },
      { onSuccess: close, onError: (err) => toast.error(errorMessage(err)) },
    );
  });

  return (
    <Dialog open={!!inbox} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Send a test email</DialogTitle>
            <DialogDescription>From {inbox?.email}</DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="test-to">Send to</FieldLabel>
            <Input
              id="test-to"
              type="email"
              placeholder="you@yourcompany.com"
              autoFocus
              aria-invalid={!!error}
              {...form.register("to")}
            />
            <FieldDescription>Use an address you can check, e.g. your own.</FieldDescription>
            <FieldError errors={[error]} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={testSend.isPending}>
              {testSend.isPending ? "Sending…" : "Send test"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
