"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/client/api";
import { AddInboxDialog } from "./add-inbox-dialog";
import { useDiscoverMailboxes, useImportInboxes } from "./use-inboxes";

/**
 * The "Add inbox" button: pick a domain, see the mailboxes that exist on it in Microsoft 365,
 * and add only the ones you tick. "Add manually instead" opens the old form for an address that is not listed.
 */
export function ImportMailboxesDialog({ defaultDomainId }: { defaultDomainId?: string }) {
  const [open, setOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [domainId, setDomainId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const domains = useDomains({ page: 1, limit: 100 });
  const domainList = domains.data?.data ?? [];
  const activeDomainId =
    domainId ?? defaultDomainId ?? (domainList.length === 1 ? domainList[0].id : null);

  const providers = useProviders();
  // Only Microsoft 365 can list mailboxes (ZeptoMail inboxes are added with "Add manually instead").
  const providerList = (providers.data?.data ?? []).filter((p) => p.type === "microsoft");
  const activeProviderId = providerId ?? providerList[0]?.id ?? null;

  const discovery = useDiscoverMailboxes(activeDomainId, activeProviderId, open);
  const importer = useImportInboxes();

  const mailboxes = discovery.data?.mailboxes ?? [];
  const selectable = mailboxes.filter((m) => !m.alreadyAdded);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setPicked(new Set());
      setDomainId(null);
      setProviderId(null);
    }
  }

  function toggle(email: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  async function onAdd() {
    if (!activeDomainId) return;
    try {
      await importer.mutateAsync({
        domainId: activeDomainId,
        emails: [...picked],
        providerConnectionId: activeProviderId ?? undefined,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <Button onClick={() => onOpenChange(true)}>
          <PlusIcon />
          Add inbox
        </Button>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add inbox</DialogTitle>
            <DialogDescription>
              Choose a domain to see its mailboxes in Microsoft 365, then tick the ones you want to
              use for sending.
            </DialogDescription>
          </DialogHeader>

          <SimpleSelect
            value={activeDomainId}
            onChange={(value) => {
              setDomainId(value);
              setPicked(new Set());
            }}
            options={domainList.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Choose a domain"
          />

          {providerList.length > 1 && (
            <SimpleSelect
              value={activeProviderId}
              onChange={(value) => {
                setProviderId(value);
                setPicked(new Set());
              }}
              options={providerList.map((p) => ({ value: p.id, label: p.name }))}
              placeholder="Choose a Microsoft 365 connection"
            />
          )}

          {!activeDomainId ? null : discovery.isPending ? (
            <div className="grid gap-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : discovery.isError ? (
            <div className="rounded-lg border border-destructive/30 p-3 text-sm">
              <p className="font-medium text-destructive">Could not fetch mailboxes</p>
              <p className="mt-1 text-muted-foreground">{errorMessage(discovery.error)}</p>
            </div>
          ) : mailboxes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No mailboxes found for @{discovery.data.domainName} in Microsoft 365.
            </p>
          ) : (
            <div className="grid gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={selectable.length > 0 && picked.size === selectable.length}
                  disabled={selectable.length === 0}
                  onChange={(e) =>
                    setPicked(
                      e.target.checked ? new Set(selectable.map((m) => m.email)) : new Set(),
                    )
                  }
                />
                Select all ({selectable.length} available)
              </label>
              <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
                {mailboxes.map((m) => (
                  <li key={m.email}>
                    <label
                      className={`flex items-center gap-3 px-3 py-2 text-sm ${m.alreadyAdded ? "opacity-50" : "cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        disabled={m.alreadyAdded}
                        checked={picked.has(m.email)}
                        onChange={() => toggle(m.email)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{m.email}</span>
                        {m.displayName && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {m.displayName}
                          </span>
                        )}
                      </span>
                      {m.alreadyAdded && <span className="text-xs">Already added</span>}
                      {!m.enabled && !m.alreadyAdded && (
                        <span className="text-xs text-destructive">Account disabled</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="sm:mr-auto"
              onClick={() => {
                onOpenChange(false);
                setManualOpen(true);
              }}
            >
              Add manually instead
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={onAdd} disabled={picked.size === 0 || importer.isPending}>
              {importer.isPending ? "Adding…" : `Add ${picked.size || ""} selected`.trim()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddInboxDialog
        hideTrigger
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        defaultDomainId={activeDomainId ?? undefined}
      />
    </>
  );
}
