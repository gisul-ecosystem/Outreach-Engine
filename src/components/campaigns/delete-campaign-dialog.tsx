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
import type { CampaignDTO } from "@/shared/campaign";
import { useDeleteCampaign } from "./use-campaigns";

export function DeleteCampaignDialog({
  campaign,
  onClose,
  onDeleted,
}: {
  campaign: Pick<CampaignDTO, "id" | "name"> | null;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const remove = useDeleteCampaign();
  return (
    <AlertDialog open={!!campaign} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{campaign?.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Emails that were not sent yet will never be sent. Sending history and stats are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              campaign &&
              remove.mutate(campaign, {
                onSuccess: () => {
                  onClose();
                  onDeleted?.();
                },
              })
            }
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
