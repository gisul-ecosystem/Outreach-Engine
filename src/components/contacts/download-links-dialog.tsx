"use client";

import { useQueryClient } from "@tanstack/react-query";
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
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
import { FieldGroup } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { LocalLinksBanner } from "@/components/tracking/local-links-banner";
import {
  destinationOf,
  LinkTargetFields,
  savedLinkTarget,
  type LinkTarget,
} from "@/components/tracking/link-target-fields";
import { useTrackingConfig } from "@/components/tracking/use-tracking";
import { apiDownload, errorMessage } from "@/lib/client/api";
import { queryKeys } from "@/lib/client/query-keys";
import type { ListDTO } from "@/shared/list";
import type { TrackingConfigDTO } from "@/shared/tracking";

/** Lists → "Download links (CSV)": choose where the links lead and the sending domain, then download. */
export function DownloadLinksDialog({ list, onClose }: { list: ListDTO | null; onClose: () => void }) {
  const config = useTrackingConfig();
  return (
    <Dialog open={!!list} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Download links: {list?.name}</DialogTitle>
          <DialogDescription>
            One tracking link per contact of the list. Downloading again with the same choice gives
            the same links; a new choice makes new links (the old ones keep working).
          </DialogDescription>
        </DialogHeader>
        {list && config.data ? (
          // A new form per list, so the previous list's choice is not left over.
          <DownloadForm key={list.id} list={list} config={config.data} onClose={onClose} />
        ) : (
          <Skeleton className="h-40 w-full" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DownloadForm({
  list,
  config,
  onClose,
}: {
  list: ListDTO;
  config: TrackingConfigDTO;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<LinkTarget>(() =>
    savedLinkTarget(
      { destinationUrl: list.linkDestinationUrl, domainId: list.linkDomainId },
      config,
    ),
  );
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const query = new URLSearchParams({
        destinationUrl: destinationOf(target.path, config.homepage),
        ...(target.domainId ? { domainId: target.domainId } : {}),
      });
      const filename = await apiDownload(`/api/lists/${list.id}/links.csv?${query}`);
      toast.success(`Saved ${filename} (${list.contactCount} contact(s))`);
      await queryClient.invalidateQueries({ queryKey: queryKeys.lists.all }); // remembers the choice
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <LocalLinksBanner />
      <FieldGroup>
        <LinkTargetFields id="download-links" value={target} onChange={setTarget} config={config} />
      </FieldGroup>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={download} disabled={downloading}>
          <DownloadIcon />
          {downloading ? "Preparing…" : "Download CSV"}
        </Button>
      </DialogFooter>
    </>
  );
}
