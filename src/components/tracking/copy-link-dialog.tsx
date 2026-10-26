"use client";

import { CopyIcon, LinkIcon, TriangleAlertIcon } from "lucide-react";
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/client/api";
import type { ContactDTO } from "@/shared/contact";
import type { TrackedLinkDTO } from "@/shared/tracking";
import { LocalLinksBanner } from "./local-links-banner";
import { useCreateLink, useTrackingConfig } from "./use-tracking";

const DEFAULT_WORDS = "take a look at Racko";

const escapeHtml = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

/**
 * Copies the link in two forms at once (the browser clipboard can hold several formats):
 * - text/html  → Outlook pastes the chosen words with the link behind them
 * - text/plain → anywhere else (Notepad, chat) pastes the plain address
 */
async function copyLink(link: TrackedLinkDTO, words: string) {
  const html = `<a href="${escapeHtml(link.url)}">${escapeHtml(words || link.url)}</a>`;
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([link.url], { type: "text/plain" }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(link.url);
  }
}

export function CopyLinkDialog({
  contact,
  onClose,
}: {
  contact: ContactDTO | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!contact} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {/* A new form per contact, so nothing from the previous contact is left over. */}
        {contact && <CopyLinkForm key={contact.id} contact={contact} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function CopyLinkForm({ contact, onClose }: { contact: ContactDTO; onClose: () => void }) {
  const config = useTrackingConfig();
  const create = useCreateLink();
  const [path, setPath] = useState("");
  const [words, setWords] = useState(DEFAULT_WORDS);
  const [fresh, setFresh] = useState(false);
  const [copied, setCopied] = useState<TrackedLinkDTO | null>(null);

  const homepage = config.data?.homepage ?? "";
  let destination = homepage;
  try {
    destination = path.trim() ? new URL(path.trim(), homepage).toString() : homepage;
  } catch {
    // an unfinished path: the server checks the final address anyway
  }
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  const doNotEmail = contact.suppressed || contact.status !== "active";

  async function onCopy() {
    try {
      const link = await create.mutateAsync({
        contactId: contact.id,
        destinationUrl: destination,
        label: words.trim(),
        new: fresh,
      });
      await copyLink(link, words.trim());
      setCopied(link);
      toast.success("Link copied — paste it into your Outlook email.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <LinkIcon className="size-4" />
          Tracking link for {name || contact.email}
        </DialogTitle>
        <DialogDescription>
          Only paste this link into emails to {contact.email}. Their clicks are counted as theirs.
        </DialogDescription>
      </DialogHeader>

      <LocalLinksBanner />
      {doNotEmail && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          This person is {contact.suppressed ? "on the suppression list" : contact.status}. They
          asked not to be emailed (or their address bounced).
        </div>
      )}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="link-path">Destination</FieldLabel>
          <div className="flex items-center gap-1 text-sm">
            <span className="shrink-0 text-muted-foreground">{homepage || "…"}</span>
            <Input
              id="link-path"
              placeholder="/pricing (optional)"
              value={path}
              onChange={(e) => setPath(e.target.value)}
            />
          </div>
          <FieldDescription>Leave empty for the homepage.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="link-words">Link words</FieldLabel>
          <Input id="link-words" value={words} onChange={(e) => setWords(e.target.value)} />
          <FieldDescription>Outlook shows these words, with the link behind them.</FieldDescription>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fresh}
            onChange={(e) => setFresh(e.target.checked)}
            className="size-4"
          />
          Make a new link (the old one keeps working)
        </label>
      </FieldGroup>

      {copied && (
        <div className="grid gap-1 rounded-lg bg-muted p-3 text-sm">
          <span className="text-xs text-muted-foreground">Copied:</span>
          <span className="font-mono text-xs break-all">{copied.url}</span>
          <span className="text-xs text-muted-foreground">
            → {copied.destinationUrl} · {copied.realClickCount} real click(s) so far
          </span>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button onClick={onCopy} disabled={create.isPending || !homepage}>
          <CopyIcon />
          {create.isPending ? "Copying…" : copied ? "Copy again" : "Copy link"}
        </Button>
      </DialogFooter>
    </>
  );
}
