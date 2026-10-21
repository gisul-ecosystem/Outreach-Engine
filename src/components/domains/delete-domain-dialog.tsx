"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { DomainDTO } from "@/shared/domain";
import { useDeleteDomain } from "./use-domains";

/** Confirm dialog before deleting. Shows how many inboxes will be removed with the domain. */
export function DeleteDomainDialog({
  domain,
  onClose,
}: {
  domain: DomainDTO | null;
  onClose: () => void;
}) {
  const deleteDomain = useDeleteDomain();
  const inboxes = domain?.inboxCount ?? 0;

  return (
    <AlertDialog open={!!domain} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {domain?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {inboxes > 0 ? (
              <>
                This also removes its <strong>{inboxes}</strong> inbox{inboxes === 1 ? "" : "es"}.
                They stop sending immediately.{" "}
              </>
            ) : null}
            Sending history and stats are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={deleteDomain.isPending}
            onClick={() => domain && deleteDomain.mutate(domain, { onSuccess: () => onClose() })}
          >
            {deleteDomain.isPending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
