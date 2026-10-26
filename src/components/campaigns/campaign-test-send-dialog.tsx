"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiFetch, errorMessage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type { AuthUser } from "@/shared/auth";
import { emailSchema } from "@/shared/email";
import type { ReadinessInbox } from "@/shared/readiness";
import { useTestSendCampaign } from "./use-campaigns";

/**
 * "Send test to myself": the campaign's email, filled in with the list's first contact, to your own
 * address. Simulated while DRY_RUN=true. Uses the campaign's own sending format.
 */
export function CampaignTestSendDialog({
  campaignId,
  inboxes,
  open,
  onOpenChange,
}: {
  campaignId: string;
  inboxes: ReadinessInbox[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const me = useQuery({
    queryKey: queryKeys.auth.me,
    queryFn: () => apiFetch<AuthUser>("/api/auth/me"),
  });
  const testSend = useTestSendCampaign();
  const [to, setTo] = useState<string | null>(null);
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const address = to ?? me.data?.email ?? "";
  const from = inboxId ?? inboxes[0]?.id ?? null;

  const close = () => {
    onOpenChange(false);
    setError(null);
  };

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = emailSchema.safeParse(address);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    testSend.mutate(
      { id: campaignId, to: parsed.data, inboxId: from ?? undefined },
      { onSuccess: close, onError: (err) => toast.error(errorMessage(err)) },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Send a test to yourself</DialogTitle>
            <DialogDescription>
              The main version of this email, filled in with the first contact of the list.
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={!!error}>
            <FieldLabel htmlFor="campaign-test-to">Send to</FieldLabel>
            <Input
              id="campaign-test-to"
              type="email"
              autoFocus
              value={address}
              aria-invalid={!!error}
              onChange={(e) => {
                setTo(e.target.value);
                setError(null);
              }}
            />
            <FieldDescription>Use an address you can check, e.g. your own Gmail.</FieldDescription>
            <FieldError errors={error ? [{ message: error }] : []} />
          </Field>
          {inboxes.length > 1 && (
            <Field>
              <FieldLabel>Send from</FieldLabel>
              <SimpleSelect
                value={from}
                onChange={setInboxId}
                options={inboxes.map((i) => ({ value: i.id, label: i.email }))}
              />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={testSend.isPending || !from}>
              {testSend.isPending ? "Sending…" : "Send test"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
