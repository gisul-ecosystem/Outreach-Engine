"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  DownloadIcon,
  ListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiClientError, errorMessage } from "@/lib/client/api";
import { formatRelative } from "@/lib/client/format";
import { createListSchema, type CreateListInput, type ListDTO } from "@/shared/list";
import { DownloadLinksDialog } from "./download-links-dialog";
import { useCreateList, useDeleteList, useLists, useUpdateList } from "./use-contacts";

export function ListsTab() {
  const lists = useLists();
  const remove = useDeleteList();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ListDTO | null>(null);
  const [toDelete, setToDelete] = useState<ListDTO | null>(null);
  const [linksFor, setLinksFor] = useState<ListDTO | null>(null);

  const openForm = (list: ListDTO | null) => {
    setEditing(list);
    setFormOpen(true);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          A campaign sends to one list. A contact can be in many lists.
        </p>
        <Button onClick={() => openForm(null)}>
          <PlusIcon />
          New list
        </Button>
      </div>

      {lists.data?.data.length === 0 ? (
        <EmptyState
          icon={ListIcon}
          title="No lists yet"
          description="Create a list here, or create one while importing a CSV."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Contacts</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lists.isPending
                ? Array.from({ length: 3 }, (_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 5 }, (_, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-5 w-full max-w-32" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : lists.data?.data.map((list) => (
                    <TableRow key={list.id}>
                      <TableCell className="font-medium">{list.name}</TableCell>
                      <TableCell className="max-w-72 truncate text-muted-foreground">
                        {list.description || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {list.contactCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatRelative(list.createdAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon-sm" />}
                            aria-label={`Actions for ${list.name}`}
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openForm(list)}>
                              <PencilIcon />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setLinksFor(list)}>
                              <DownloadIcon />
                              Download links (CSV)
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setToDelete(list)}
                            >
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </div>
      )}

      <ListFormDialog open={formOpen} onOpenChange={setFormOpen} list={editing} />
      <DownloadLinksDialog list={linksFor} onClose={() => setLinksFor(null)} />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete list &quot;{toDelete?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              The {toDelete?.contactCount ?? 0} contact(s) in it are NOT deleted — they stay in your
              contacts and in any other lists.
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
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ListFormDialog({
  open,
  onOpenChange,
  list,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: ListDTO | null;
}) {
  const create = useCreateList();
  const update = useUpdateList();
  const form = useForm<CreateListInput>({
    resolver: zodResolver(createListSchema),
    values: { name: list?.name ?? "", description: list?.description ?? "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (list) await update.mutateAsync({ id: list.id, ...values });
      else await create.mutateAsync(values);
      toast.success(`List "${values.name}" saved`);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        form.setError("name", { message: err.message });
      } else {
        toast.error(errorMessage(err));
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{list ? "Edit list" : "New list"}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="list-name">Name</FieldLabel>
              <Input id="list-name" aria-invalid={!!errors.name} {...form.register("name")} />
              <FieldError errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="list-description">Description (optional)</FieldLabel>
              <Textarea id="list-description" rows={3} {...form.register("description")} />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
