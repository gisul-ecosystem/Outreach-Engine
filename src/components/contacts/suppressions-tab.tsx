"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BanIcon, PlusIcon, SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { SimpleSelect } from "@/components/common/simple-select";
import { EmptyState } from "@/components/layout/empty-state";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import { formatRelative } from "@/lib/client/format";
import { useDebouncedValue } from "@/lib/client/use-debounced-value";
import type { SuppressionReason } from "@/shared/enums";
import {
  createSuppressionSchema,
  type CreateSuppressionInput,
  type SuppressionDTO,
  type SuppressionImportReport,
} from "@/shared/suppression";
import {
  useCreateSuppression,
  useDeleteSuppression,
  useImportSuppressions,
  useSuppressions,
} from "./use-contacts";

const PAGE_SIZE = 25;
const REASON_OPTIONS: { value: SuppressionReason; label: string }[] = [
  { value: "manual", label: "Manual (added by us)" },
  { value: "unsubscribed", label: "Unsubscribed (asked to stop)" },
  { value: "bounced", label: "Bounced (address doesn't exist)" },
  { value: "complaint", label: "Complaint (marked as spam)" },
];

export function SuppressionsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [toDelete, setToDelete] = useState<SuppressionDTO | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim());
  const suppressions = useSuppressions({
    page,
    limit: PAGE_SIZE,
    search: debouncedSearch || undefined,
  });
  const remove = useDeleteSuppression();

  const total = suppressions.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        People on this list are <strong>never</strong> emailed, even if they are in a
        campaign&apos;s list. When someone replies &quot;no&quot; or &quot;unsubscribe&quot;, add
        them here.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search email"
            className="pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {suppressions.data ? `${total.toLocaleString()} suppressed` : " "}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <UploadIcon />
            Import CSV
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusIcon />
            Add email
          </Button>
        </div>
      </div>

      {suppressions.data && total === 0 ? (
        <EmptyState
          icon={BanIcon}
          title={debouncedSearch ? "No match" : "Nobody is suppressed yet"}
          description="Add emails of people who must never be contacted."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppressions.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : suppressions.data?.data.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {s.reason}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">
                        {s.note || "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelative(s.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${s.email}`}
                          onClick={() => setToDelete(s)}
                        >
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <AddSuppressionDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportSuppressionsDialog open={importOpen} onOpenChange={setImportOpen} />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {toDelete?.email} from the suppression list?</AlertDialogTitle>
            <AlertDialogDescription>
              Only do this if the person asked to be contacted again. Their contact stays marked
              unsubscribed/bounced — edit the contact to make it active again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                toDelete && remove.mutate(toDelete, { onSuccess: () => setToDelete(null) })
              }
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AddSuppressionDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateSuppression();
  const form = useForm<CreateSuppressionInput>({
    resolver: zodResolver(createSuppressionSchema),
    defaultValues: { email: "", reason: "manual", note: "" },
  });
  const { errors } = form.formState;

  const close = () => {
    onOpenChange(false);
    form.reset();
  };

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
      close();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        form.setError("email", { message: err.message });
      } else {
        toast.error(errorMessage(err));
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add to suppression list</DialogTitle>
            <DialogDescription>This email will never be sent to again.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="s-email">Email</FieldLabel>
              <Input
                id="s-email"
                type="email"
                aria-invalid={!!errors.email}
                {...form.register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="s-reason">Reason</FieldLabel>
              <Controller
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <SimpleSelect
                    id="s-reason"
                    value={field.value ?? "manual"}
                    onChange={field.onChange}
                    options={REASON_OPTIONS}
                  />
                )}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="s-note">Note (optional)</FieldLabel>
              <Input
                id="s-note"
                placeholder="e.g. replied 'not interested'"
                {...form.register("note")}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportSuppressionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const importMutation = useImportSuppressions();
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState<string>("manual");
  const [report, setReport] = useState<SuppressionImportReport | null>(null);

  const close = () => {
    onOpenChange(false);
    setFile(null);
    setReason("manual");
    setReport(null);
  };

  async function run() {
    if (!file) return;
    try {
      setReport(await importMutation.mutateAsync({ file, reason, note: "" }));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import suppression list</DialogTitle>
          <DialogDescription>A CSV with a column named &quot;email&quot;.</DialogDescription>
        </DialogHeader>
        {report ? (
          <div className="grid gap-2 text-sm">
            <p>
              <strong>{report.added}</strong> added, {report.alreadySuppressed} already on the list,{" "}
              {report.duplicatesInFile} duplicates in the file, {report.invalid} invalid.
            </p>
            <p className="text-muted-foreground">
              {report.contactsUpdated} existing contact(s) were marked as{" "}
              {reason === "bounced" ? "bounced" : "unsubscribed"}.
            </p>
            <DialogFooter>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="s-file">CSV file</FieldLabel>
              <Input
                id="s-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <FieldDescription>Max 5 MB / 50,000 rows.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Reason for all emails in the file</FieldLabel>
              <SimpleSelect value={reason} onChange={setReason} options={REASON_OPTIONS} />
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={close}>
                Cancel
              </Button>
              <Button onClick={run} disabled={!file || importMutation.isPending}>
                {importMutation.isPending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
