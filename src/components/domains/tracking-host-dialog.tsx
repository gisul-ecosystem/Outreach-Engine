"use client";

import { useState } from "react";
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
import type { DomainDTO } from "@/shared/domain";
import { useSetTrackingHost } from "./use-domains";

/** Domains → "Tracking address": the host of the tracking links in emails sent from this domain. */
export function TrackingHostDialog({
  domain,
  onClose,
}: {
  domain: DomainDTO | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!domain} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* A new form per domain, so nothing from the previous domain is left over. */}
        {domain && <TrackingHostForm key={domain.id} domain={domain} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function TrackingHostForm({ domain, onClose }: { domain: DomainDTO; onClose: () => void }) {
  const save = useSetTrackingHost();
  const [host, setHost] = useState(domain.trackingHost ?? `go.${domain.name}`);
  const [error, setError] = useState<string | null>(null);

  async function submit(trackingHost: string) {
    setError(null);
    try {
      await save.mutateAsync({ id: domain.id, trackingHost });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(host);
      }}
    >
      <DialogHeader>
        <DialogTitle>Tracking address for {domain.name}</DialogTitle>
        <DialogDescription>
          Tracking links in emails sent from {domain.name} will start with this address, so the link
          matches the sender&apos;s domain (better for spam filters).
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor="tracking-host">Address</FieldLabel>
          <Input
            id="tracking-host"
            value={host}
            placeholder={`go.${domain.name}`}
            aria-invalid={!!error}
            onChange={(e) => setHost(e.target.value)}
          />
          <FieldDescription>
            Links look like <span className="font-mono">https://{host || "…"}/r/abc123…</span>.
            Before using it: add a DNS <b>A record</b> for it pointing to the engine&apos;s server,
            and add it to the HTTPS certificate (Nginx + Certbot) — see README.
          </FieldDescription>
          {error && <FieldError>{error}</FieldError>}
        </Field>
      </FieldGroup>
      <DialogFooter>
        {domain.trackingHost && (
          <Button
            type="button"
            variant="outline"
            className="sm:mr-auto"
            disabled={save.isPending}
            onClick={() => void submit("")}
          >
            Remove
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending || !host.trim()}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
